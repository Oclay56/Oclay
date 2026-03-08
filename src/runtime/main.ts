import crypto from "node:crypto";
import type { Logger } from "pino";
import PQueue from "p-queue";
import type { AppConfig } from "../config/schema";
import type { RuntimeEnv } from "../config/loadConfig";
import type { DexPairSnapshot, Position, TokenRiskReport, TradeIntent } from "../domain/types";
import { deriveWorkflowPhaseFromPosition, type WorkflowPhase, withWorkflowPhaseMeta } from "../domain/workflowPhase";
import { DexScreenerClient } from "../providers/dexscreener";
import { JupiterUltraClient } from "../providers/jupiterUltra";
import { SolanaRpc } from "../providers/solanaRpc";
import { openSqlite } from "../storage/sqlite";
import { runMigrations } from "../storage/migrations";
import { createRepos } from "../storage/repos";
import { discoveryLoop } from "../discovery/discoveryLoop";
import { analyzeToken } from "../analyzer/analyzeToken";
import { analyzeStageA } from "../analyzer/analyzeStageA";
import { analyzeStageB, classifyStageBStatus, type StageBStatus } from "../analyzer/analyzeStageB";
import { decideEntryIntent } from "../strategy/decide";
import { executePaperBuy, executePaperSell } from "../execution/paper";
import { executeLiveBuy, executeLiveSell } from "../execution/swap";
import { loadKeypairFromFile } from "../execution/wallet";
import { guardianLoop } from "../guardian/guardianLoop";
import { checkRuntimeEntryRisk } from "../strategy/riskGuards";
import { createSell429Breaker, isJupiterRateLimitError } from "../execution/sell429Breaker";
import { getLossBreakerStatus } from "../strategy/lossBreaker";
import { HeliusStreamClient } from "../providers/heliusStream";
import { startStreamDiscovery } from "../discovery/streamDiscovery";
import { decideSniperScale } from "../strategy/sniperStateMachine";
import { executeRoutedLiveBuy } from "../execution/router";
import { RaydiumProvider } from "../providers/raydium";
import { lamportsToUsdNumber } from "../utils/fixedPoint";
import { sleepMs } from "../utils/time";
import type { RuntimeDashboardStatePatch } from "./dashboardState";
import {
  createEntryAdmissionState,
  releaseEntryAdmission,
  resetEntryAdmissionState,
  tryReserveEntryAdmission
} from "./entryAdmission";

interface CandidateFlowState {
  candidateId: string;
  mint: string;
  detectedAtMs: number;
  source: string;
  txSig?: string;
  stageAAtMs?: number;
  baselineLiquidityUsd?: number | null;
  stageBReport?: TokenRiskReport;
  stageBStatus: StageBStatus;
  stageBReason?: string;
  stageBUpdatedAtMs?: number;
}

interface PositionFlowState {
  candidateId?: string;
  mint: string;
  source: string;
  detectAtMs?: number;
  analyzeAAtMs?: number;
  intentAtMs?: number;
  entryPath?: "raydium_direct" | "jupiter_fallback" | "jupiter_only" | "paper";
  stageAFlags?: string[];
  stageBFlags?: string[];
}

const LAMPORTS_PER_SOL = 1_000_000_000;

export async function runBot(params: {
  cfg: AppConfig;
  env: RuntimeEnv;
  logger: Logger;
  forcePaper?: boolean;
  stopAfterMs?: number;
  registerSignalHandlers?: boolean;
  externalStopSignal?: AbortSignal;
  onRuntimeDashboardState?: (statePatch: RuntimeDashboardStatePatch) => void;
}): Promise<void> {
  const { cfg, env, logger } = params;
  const mode: "paper" | "live" = params.forcePaper ? "paper" : env.liveTradingEnabled ? "live" : "paper";
  const allowEntries = !env.killSwitch;

  if (mode === "live") {
    if (!env.walletKeypairPath) throw new Error("WALLET_KEYPAIR_PATH is required for live trading.");
    logger.warn("LIVE TRADING ENABLED");
  } else {
    logger.info("paper mode");
  }
  if (!allowEntries) logger.warn("KILL SWITCH ENABLED: entries disabled (exits still allowed).");

  const db = openSqlite(env.dbPath);
  runMigrations(db);
  const repos = createRepos(db);
  const normalized = repos.normalizeTransientPositionStates();
  if (normalized > 0) logger.warn({ normalized }, "normalized transient position states (ENTERING->OPEN)");

  const dex = new DexScreenerClient(env.dexScreenerBaseUrl, logger);
  const jup = new JupiterUltraClient(env.jupBaseUrl, env.jupApiKey, logger);
  const rpc = new SolanaRpc(env.rpcUrl, {
    commitment: "confirmed",
    concurrency: env.rpcConcurrency,
    intervalCap: env.rpcIntervalCap,
    intervalMs: env.rpcIntervalMs
  });
  const raydium = new RaydiumProvider(cfg, logger, env.raydiumApiBaseUrl);

  const wallet = mode === "live" ? loadKeypairFromFile(env.walletKeypairPath!) : null;

  const abort = new AbortController();
  const stopSignal = abort.signal;
  if (params.registerSignalHandlers !== false) {
    setupSignalHandlers(logger, abort);
  }
  if (params.externalStopSignal) {
    if (params.externalStopSignal.aborted) {
      abort.abort();
    } else {
      params.externalStopSignal.addEventListener(
        "abort",
        () => {
          logger.warn("external stop requested; stopping");
          abort.abort();
        },
        { once: true }
      );
    }
  }

  let stopTimer: NodeJS.Timeout | undefined;
  if (params.stopAfterMs && params.stopAfterMs > 0) {
    const stopAfterMs = Math.floor(params.stopAfterMs);
    stopTimer = setTimeout(() => {
      logger.warn({ stopAfterMs }, "duration reached; stopping");
      abort.abort();
    }, stopAfterMs);
    // Allow the event loop to exit even if the timer is pending in very short runs.
    stopTimer.unref?.();
  }

  const analysisQueue = new PQueue({ concurrency: env.maxConcurrency });
  const execQueue = new PQueue({ concurrency: 1 });
  const entryAdmission = createEntryAdmissionState();
  stopSignal.addEventListener("abort", () => {
    // Drop queued analysis tasks on shutdown so we don't take minutes to drain a backlog.
    analysisQueue.pause();
    analysisQueue.clear();
    resetEntryAdmissionState(entryAdmission);
    emitRuntimeDashboardState({
      capital: {
        pendingReservedEntryUsd: 0
      }
    });
  });

  const inAnalysis = new Set<string>();
  const lastAnalyzedAt = new Map<string, number>();
  const probePassUntilMs = new Map<string, number>();
  const candidateFlow = new Map<string, CandidateFlowState>();
  const mintCandidateIndex = new Map<string, string>();
  const positionFlow = new Map<string, PositionFlowState>();
  const runId = crypto.randomUUID();
  const sell429Breaker = createSell429Breaker(cfg.execution.sell429);
  let analysisErrStreak = 0;
  let analysisBackoffUntilMs = 0;
  let baseUsdCache: { at: number; v: number } | undefined;
  let walletBalanceInFlight = false;
  const streamState = {
    enabled: cfg.discovery.stream.enabled,
    connected: false,
    stale: false,
    fallbackActive: false,
    lastEventAtMs: 0
  };
  let capitalMetricsInFlight = false;

  function emitRuntimeDashboardState(statePatch: RuntimeDashboardStatePatch): void {
    if (!params.onRuntimeDashboardState) return;
    try {
      params.onRuntimeDashboardState(statePatch);
    } catch (err) {
      logger.debug({ err: String(err) }, "runtime dashboard observer callback failed");
    }
  }

  function emitStreamState(): void {
    emitRuntimeDashboardState({
      stream: {
        enabled: streamState.enabled,
        connected: streamState.connected,
        stale: streamState.stale,
        fallbackActive: streamState.fallbackActive,
        lastEventAtMs: streamState.lastEventAtMs > 0 ? streamState.lastEventAtMs : undefined
      }
    });
  }

  function emitSell429State(nowMs: number): void {
    const snapshot = sell429Breaker.getSnapshot(nowMs);
    emitRuntimeDashboardState({
      sell429: {
        globalCooldownUntilMs: snapshot.globalCooldownUntilMs,
        perMint: snapshot.perMint
      }
    });
  }

  function emitReservedCapitalState(): void {
    emitRuntimeDashboardState({
      capital: {
        pendingReservedEntryUsd: entryAdmission.reservedLiveEntryUsd
      }
    });
  }

  async function getBaseAssetUsdPrice(): Promise<number | null> {
    try {
      if (baseUsdCache && Date.now() - baseUsdCache.at < 30_000) return baseUsdCache.v;
      const oneSolLamports = "1000000000";
      const q = await jup.getOrder({
        inputMint: cfg.assets.baseAssetMint,
        outputMint: cfg.assets.quoteAssetMint,
        amount: oneSolLamports,
        signal: stopSignal
      });
      const out = BigInt(q.outAmount);
      const usd = Number(out) / 1_000_000; // USDC decimals
      if (!Number.isFinite(usd) || usd <= 0) return null;
      baseUsdCache = { at: Date.now(), v: usd };
      return usd;
    } catch {
      return null;
    }
  }

  async function readWalletBalanceSnapshot(
    nowMs: number,
    baseAssetUsdPrice?: number | null
  ): Promise<{ walletSolBalance: number; walletUsdBalance?: number; walletBalanceAtMs: number } | null> {
    if (!wallet || walletBalanceInFlight) return null;
    walletBalanceInFlight = true;
    try {
      const lamports = await rpc.getBalance(wallet.publicKey.toBase58());
      if (!Number.isFinite(lamports) || lamports < 0) return null;
      const walletSolBalance = lamports / LAMPORTS_PER_SOL;
      const price =
        typeof baseAssetUsdPrice === "number" && Number.isFinite(baseAssetUsdPrice) && baseAssetUsdPrice > 0
          ? baseAssetUsdPrice
          : baseUsdCache?.v;
      const walletUsdBalance =
        price !== undefined && Number.isFinite(price) && price > 0 ? walletSolBalance * price : undefined;
      return {
        walletSolBalance,
        walletUsdBalance,
        walletBalanceAtMs: nowMs
      };
    } catch (err) {
      logger.debug({ err: String(err) }, "wallet balance poll failed");
      return null;
    } finally {
      walletBalanceInFlight = false;
    }
  }

  async function emitWalletBalanceState(nowMs: number): Promise<void> {
    const walletBalance = await readWalletBalanceSnapshot(nowMs, baseUsdCache?.v);
    if (!walletBalance) return;
    emitRuntimeDashboardState({
      capital: {
        walletSolBalance: walletBalance.walletSolBalance,
        walletUsdBalance: walletBalance.walletUsdBalance,
        walletBalanceAtMs: walletBalance.walletBalanceAtMs
      }
    });
  }

  async function emitCapitalState(nowMs: number): Promise<void> {
    if (capitalMetricsInFlight) return;
    capitalMetricsInFlight = true;
    try {
      const baseAssetUsdPrice = await getBaseAssetUsdPrice();
      const walletBalance = await readWalletBalanceSnapshot(nowMs, baseAssetUsdPrice);
      const openPositions = repos.getOpenPositions();
      const dayStart = new Date(nowMs);
      dayStart.setHours(0, 0, 0, 0);
      const realizedPnlUsd = repos.realizedPnlUsdSince(dayStart.getTime());

      let deployedUsd = 0;
      if (baseAssetUsdPrice && baseAssetUsdPrice > 0) {
        for (const p of openPositions) {
          deployedUsd += lamportsToUsd(p.entryBaseAmount, baseAssetUsdPrice);
        }
      }

      let unrealizedPnlUsd = 0;
      if (baseAssetUsdPrice && baseAssetUsdPrice > 0 && openPositions.length > 0) {
        const bounded = openPositions.slice(0, Math.max(1, cfg.strategy.portfolio.maxOpenPositions));
        for (const p of bounded) {
          try {
            const inventory = p.currentTokenAmount > 0n ? p.currentTokenAmount : p.entryTokenAmount;
            if (inventory <= 0n) continue;
            const quote = await jup.getOrder({
              inputMint: p.mint,
              outputMint: cfg.assets.baseAssetMint,
              amount: inventory.toString(),
              slippageBps: cfg.execution.slippageBpsExit
            });
            const baseOut = BigInt(quote.outAmount);
            const pnlLamports = baseOut - p.entryBaseAmount;
            unrealizedPnlUsd += lamportsToUsd(pnlLamports, baseAssetUsdPrice);
          } catch (err) {
            logger.debug({ mint: p.mint, err: String(err) }, "capital panel unrealized quote failed");
          }
        }
      }

      const dailyTotal = realizedPnlUsd + unrealizedPnlUsd;
      const dailyDrawdownUsd = dailyTotal < 0 ? Math.abs(dailyTotal) : 0;

      emitRuntimeDashboardState({
        capital: {
          pendingReservedEntryUsd: entryAdmission.reservedLiveEntryUsd,
          baseAssetUsdPrice: baseAssetUsdPrice ?? undefined,
          baseAssetUsdPriceAtMs: baseUsdCache?.at,
          walletSolBalance: walletBalance?.walletSolBalance,
          walletUsdBalance: walletBalance?.walletUsdBalance,
          walletBalanceAtMs: walletBalance?.walletBalanceAtMs,
          realizedPnlUsd,
          unrealizedPnlUsd,
          deployedUsd,
          dailyDrawdownUsd
        }
      });
    } finally {
      capitalMetricsInFlight = false;
    }
  }

  emitStreamState();
  emitSell429State(Date.now());
  void emitWalletBalanceState(Date.now()).catch((err) =>
    logger.debug({ err: String(err) }, "initial wallet balance state emit failed")
  );
  void emitCapitalState(Date.now()).catch((err) =>
    logger.debug({ err: String(err) }, "initial capital state emit failed")
  );

  function enqueueAnalysis(
    mint: string,
    bestPair: DexPairSnapshot | null,
    source: string,
    detectedAtMs?: number,
    txSig?: string,
    candidateId?: string,
    detectionMeta?: Record<string, unknown>
  ) {
    if (stopSignal.aborted) return;
    const now = Date.now();
    const detectedMs = detectedAtMs ?? now;
    const resolvedCandidateId =
      candidateId ??
      crypto
        .createHash("sha1")
        .update(`${mint}:${source}:${detectedMs}:${txSig ?? ""}`)
        .digest("hex")
        .slice(0, 24);
    candidateFlow.set(resolvedCandidateId, {
      candidateId: resolvedCandidateId,
      mint,
      detectedAtMs: detectedMs,
      source,
      txSig,
      stageBStatus: "pending",
      stageBReason: "stageb_pending"
    });
    mintCandidateIndex.set(mint, resolvedCandidateId);
    writeLifecycle({
      mint,
      stage: "DETECTED",
      atMs: detectedMs,
      candidateId: resolvedCandidateId,
      meta: { source, txSig, ...(detectionMeta ?? {}) },
      workflowPhase: "DISCOVERED"
    });

    const activePosition = repos.getOpenPositionByMint(mint);
    if (activePosition) {
      writeLifecycle({
        mint,
        stage: "CANDIDATE_SUPPRESSED",
        atMs: now,
        candidateId: resolvedCandidateId,
        positionId: activePosition.id,
        meta: {
          reason: "suppressed_open_position",
          activePositionStatus: activePosition.status,
          activeWorkflowPhase: deriveWorkflowPhaseFromPosition({
            status: activePosition.status,
            stage: activePosition.stage
          })
        },
        workflowPhase: "BLOCKED"
      });
      return;
    }

    if (now < analysisBackoffUntilMs) {
      writeLifecycle({
        mint,
        stage: "ANALYZE_SKIPPED",
        atMs: now,
        candidateId: resolvedCandidateId,
        meta: { reason: "analysis_backoff_active", backoffUntilMs: analysisBackoffUntilMs },
        workflowPhase: "BLOCKED"
      });
      return;
    }
    const last = lastAnalyzedAt.get(mint) ?? 0;
    if (now - last < 20_000) {
      writeLifecycle({
        mint,
        stage: "ANALYZE_SKIPPED",
        atMs: now,
        candidateId: resolvedCandidateId,
        meta: { reason: "analysis_mint_cooldown", cooldownMs: 20_000 },
        workflowPhase: "BLOCKED"
      });
      return;
    }
    if (inAnalysis.has(mint)) {
      writeLifecycle({
        mint,
        stage: "ANALYZE_SKIPPED",
        atMs: now,
        candidateId: resolvedCandidateId,
        meta: { reason: "analysis_in_flight_for_mint" },
        workflowPhase: "BLOCKED"
      });
      return;
    }

    inAnalysis.add(mint);
    lastAnalyzedAt.set(mint, now);

    analysisQueue
      .add(async () => {
        if (stopSignal.aborted) return;
        try {
          const activeBlock = repos.getBlock(mint, Date.now());
          const activeFlags = activeBlock?.reason?.startsWith("probe_failed:") ? (["PROBE_FAILED"] as any) : [];
          const stageA = await analyzeStageA({
            cfg,
            mint,
            bestPair,
            rpc,
            jup,
            logger,
            activeFlags
          });
          if (stopSignal.aborted) return;
          repos.insertSnapshot({ mint, capturedAtMs: Date.now(), pair: bestPair });
          const flow = candidateFlow.get(resolvedCandidateId);
          repos.insertRiskReport(stageA.report);
          writeLifecycle({
            mint,
            stage: "ANALYZE_A_DONE",
            atMs: Date.now(),
            candidateId: resolvedCandidateId,
            meta: {
              riskScore: stageA.report.riskScore,
              tradeScore: stageA.report.tradeScore,
              flags: stageA.report.flags
            },
            workflowPhase: "ANALYZING"
          });
          if (flow) {
            flow.stageAAtMs = Date.now();
            flow.baselineLiquidityUsd = stageA.report.liquidityUsd ?? null;
            flow.stageBStatus = "pending";
            flow.stageBReason = "stageb_pending";
            flow.stageBUpdatedAtMs = Date.now();
          }
          analysisErrStreak = 0;
          if (stopSignal.aborted) return;

          const shouldRunStageB = !(cfg.analysis.skipDeepChecksOnHardReject && stageA.hardReject);

          const lossBreaker = getLossBreakerStatus({ cfg, repos, mode });
          if (lossBreaker.blocked) {
            writeLifecycle({
              mint,
              stage: "ENTRY_BLOCKED",
              candidateId: resolvedCandidateId,
              meta: {
                reason: "loss_breaker_active",
                consecutiveLosses: lossBreaker.consecutiveLosses,
                blockedUntilMs: lossBreaker.blockedUntilMs
              },
              workflowPhase: "BLOCKED"
            });
            logger.warn(
              { mint, consecutiveLosses: lossBreaker.consecutiveLosses, blockedUntilMs: lossBreaker.blockedUntilMs },
              "entry blocked by consecutive-loss breaker"
            );
            return;
          }

          const baseUsd = await getBaseAssetUsdPrice();
          const decision = decideEntryIntent({
            cfg,
            report: stageA.report,
            mode,
            repos,
            logger,
            baseAssetUsdPrice: baseUsd
          });
          if (!decision.ok) {
            writeLifecycle({
              mint,
              stage: "ENTRY_REJECTED",
              candidateId: resolvedCandidateId,
              meta: {
                reason: decision.rejectReason,
                tradeScore: stageA.report.tradeScore,
                flags: stageA.report.flags
              },
              workflowPhase: "REJECTED"
            });
          }
          if (decision.ok && !allowEntries) {
            writeLifecycle({
              mint,
              stage: "ENTRY_DISABLED",
              candidateId: resolvedCandidateId,
              meta: {
                reason: "kill_switch_active",
                tradeScore: stageA.report.tradeScore,
                flags: stageA.report.flags
              },
              workflowPhase: "BLOCKED"
            });
          }
          if (decision.ok && allowEntries) {
            const intent = decision.intent;
            if (stopSignal.aborted) return;
            const guard = await checkRuntimeEntryRisk({
              cfg,
              repos,
              jup,
              rpc,
              logger,
              mode,
              intent,
              walletPubkey: wallet?.publicKey.toBase58(),
              baseAssetUsdPrice: baseUsd,
              pendingReservedEntryUsd: mode === "live" ? entryAdmission.reservedLiveEntryUsd : 0
            });
            if (!guard.ok) {
              writeLifecycle({
                mint,
                stage: "ENTRY_BLOCKED",
                candidateId: resolvedCandidateId,
                meta: {
                  reason: guard.reason ?? "runtime_risk_guard",
                  realizedPnlUsd: guard.realizedPnlUsd,
                  unrealizedPnlUsd: guard.unrealizedPnlUsd
                },
                workflowPhase: "BLOCKED"
              });
              logger.warn({ mint, guard }, "entry blocked by runtime risk guard");
              return;
            }
            const reservation = tryReserveEntryAdmission({
              state: entryAdmission,
              cfg,
              repos,
              mode,
              intent,
              baseAssetUsdPrice: baseUsd
            });
            if (!reservation.ok) {
              writeLifecycle({
                mint,
                stage: "ENTRY_BLOCKED",
                candidateId: resolvedCandidateId,
                meta: {
                  reason: reservation.reason ?? "entry_admission_reservation_failed"
                },
                workflowPhase: "BLOCKED"
              });
              logger.warn({ mint, reason: reservation.reason }, "entry blocked by admission reservation");
              return;
            }
            emitReservedCapitalState();
            intent.positionId = crypto.randomUUID();
            const flowForCandidate = candidateFlow.get(resolvedCandidateId);
            writeLifecycle({
              mint,
              stage: "INTENT_CREATED",
              atMs: Date.now(),
              candidateId: resolvedCandidateId,
              positionId: intent.positionId,
              intentId: intent.id,
              meta: { type: intent.type, intentKind: intent.intentKind, reason: intent.reason },
              workflowPhase: "ENTERING"
            });
            intent.candidateId = resolvedCandidateId;
            positionFlow.set(intent.positionId, {
              candidateId: resolvedCandidateId,
              mint,
              source: flowForCandidate?.source ?? source,
              detectAtMs: flowForCandidate?.detectedAtMs,
              analyzeAAtMs: flowForCandidate?.stageAAtMs,
              intentAtMs: Date.now(),
              stageAFlags: stageA.report.flags
            });
            let released = false;
            const release = () => {
              if (released) return;
              released = true;
              releaseEntryAdmission({
                state: entryAdmission,
                mint: intent.mint,
                reservedUsd: reservation.reservedUsd,
                reservedMint: reservation.reservedMint,
                reservedSlot: reservation.reservedSlot
              });
              emitReservedCapitalState();
            };
            void execQueue
              .add(async () => {
                try {
                  await executeIntent(intent, bestPair);
                } finally {
                  release();
                }
              })
              .catch((err) => {
                release();
                logger.warn({ intentId: intent.id, mint: intent.mint, err: String(err) }, "execution task failed");
              });
            if (cfg.strategy.sniper.enabled && intent.intentKind === "ENTRY_TEST") {
              scheduleSniperScale({
                positionId: intent.positionId,
                candidateId: resolvedCandidateId,
                mint,
                source: flowForCandidate?.source ?? source,
                baselinePair: bestPair
              });
            }
          }
          if (shouldRunStageB) {
            void analysisQueue
              .add(async () => {
                try {
                  const stageBReport = await analyzeStageB({
                    cfg,
                    mint,
                    bestPair,
                    stageA: stageA.report,
                    repos,
                    rpc,
                    logger
                  });
                  repos.insertRiskReport(stageBReport);
                  const currentFlow = candidateFlow.get(resolvedCandidateId);
                  const stageBClass = classifyStageBStatus(stageBReport);
                  if (currentFlow) {
                    currentFlow.stageBReport = stageBReport;
                    currentFlow.stageBStatus = stageBClass.status;
                    currentFlow.stageBReason = stageBClass.reason;
                    currentFlow.stageBUpdatedAtMs = Date.now();
                  }
                  writeLifecycle({
                    mint,
                    stage: "ANALYZE_B_DONE",
                    atMs: Date.now(),
                    candidateId: resolvedCandidateId,
                    meta: {
                      status: stageBClass.status,
                      reason: stageBClass.reason,
                      flags: stageBReport.flags
                    },
                    workflowPhase: "ANALYZING"
                  });
                } catch (err) {
                  const currentFlow = candidateFlow.get(resolvedCandidateId);
                  if (currentFlow) {
                    currentFlow.stageBStatus = "failed";
                    currentFlow.stageBReason = `stageb_error:${String(err)}`;
                    currentFlow.stageBUpdatedAtMs = Date.now();
                  }
                  throw err;
                }
              })
              .catch((err) => logger.debug({ mint, err: String(err) }, "stageB analysis failed"));
          } else {
            const flowForCandidate = candidateFlow.get(resolvedCandidateId);
            if (flowForCandidate) {
              flowForCandidate.stageBStatus = "failed";
              flowForCandidate.stageBReason = "stageb_skipped_on_hard_reject";
              flowForCandidate.stageBUpdatedAtMs = Date.now();
            }
          }
        } catch (err) {
          if (isRateOrTimeoutError(err)) {
            analysisErrStreak++;
            if (analysisErrStreak >= 3) {
              const backoffMs = Math.min(120_000, 5_000 * analysisErrStreak);
              analysisBackoffUntilMs = Date.now() + backoffMs;
              logger.warn({ analysisErrStreak, backoffMs }, "analysis rate/timeout pressure; backing off");
            }
          } else {
            analysisErrStreak = 0;
          }
          throw err;
        } finally {
          inAnalysis.delete(mint);
        }
      })
      .catch((err) => logger.warn({ mint, err: String(err) }, "analysis task failed"));
  }

  function scheduleSniperScale(params: {
    positionId: string;
    candidateId: string;
    mint: string;
    source: string;
    baselinePair: DexPairSnapshot | null;
  }): void {
    const delayMs = Math.max(1_000, cfg.strategy.sniper.scaleDelayMs);
    const timer = setTimeout(() => {
      if (stopSignal.aborted) return;
      void runSniperScaleAttempt(params).catch((err) =>
        logger.warn({ mint: params.mint, positionId: params.positionId, err: String(err) }, "sniper scale task failed")
      );
    }, delayMs);
    timer.unref?.();
    stopSignal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  }

  async function runSniperScaleAttempt(params: {
    positionId: string;
    candidateId: string;
    mint: string;
    source: string;
    baselinePair: DexPairSnapshot | null;
  }): Promise<void> {
    const position = repos.getPositionById(params.positionId);
    if (!position || position.status === "CLOSED") return;
    if (position.stage !== "TEST") return;

    let latestPair: DexPairSnapshot | null = params.baselinePair;
    try {
      const pairs = await dex.getTokenPairs(params.mint, stopSignal);
      latestPair = dex.selectBestPair({
        pairs,
        minLiquidityUsd: 0,
        dexAllowlist: cfg.discovery.dexAllowlist,
        preferMints: [cfg.assets.baseAssetMint, cfg.assets.quoteAssetMint]
      });
    } catch {
      // keep best-effort baseline pair
    }

    const sellProbeAmount = position.currentTokenAmount > 0n ? position.currentTokenAmount : position.entryTokenAmount;
    let routeHealthy = true;
    try {
      await jup.getOrder({
        inputMint: position.mint,
        outputMint: cfg.assets.baseAssetMint,
        amount: sellProbeAmount.toString(),
        slippageBps: cfg.execution.slippageBpsExit
      });
    } catch {
      routeHealthy = false;
    }

    const positionCandidateId = positionFlow.get(position.id)?.candidateId;
    const resolvedCandidateId = positionCandidateId ?? params.candidateId;
    const flow = resolvedCandidateId ? candidateFlow.get(resolvedCandidateId) : undefined;
    const baselineLiq = flow?.baselineLiquidityUsd ?? params.baselinePair?.liquidityUsd ?? null;
    const currentLiq = latestPair?.liquidityUsd ?? null;
    let liqDegradePct: number | undefined;
    if (baselineLiq !== null && baselineLiq !== undefined && baselineLiq > 0 && currentLiq !== null) {
      liqDegradePct = ((baselineLiq - currentLiq) / baselineLiq) * 100;
    }

    let stageBStatus: "pending" | "clean" | "critical" | "failed" | "timeout" = "pending";
    let stageBReason = flow?.stageBReason ?? "stageb_pending";
    if (cfg.strategy.sniper.requireStageBForScale) {
      const waited = await waitForStageBResolution(resolvedCandidateId);
      stageBStatus = waited.status;
      stageBReason = waited.reason;
    } else {
      stageBStatus = flow?.stageBStatus ?? "pending";
    }

    const stageBFlags = flow?.stageBReport?.flags ?? [];
    const hasCritical =
      hasCriticalStageBFlags(stageBFlags) || stageBStatus === "critical" || stageBStatus === "failed";

    const decision = decideSniperScale({
      cfg,
      position,
      nowMs: Date.now(),
      routeHealthy,
      liquidityDegradePct: liqDegradePct,
      hasCriticalFlags: hasCritical,
      stageBStatus
    });

    writeLifecycle({
      mint: position.mint,
      stage: decision.shouldScale ? "SCALE_READY" : "SCALE_REJECTED",
      positionId: position.id,
      candidateId: resolvedCandidateId,
      meta: {
        reason: decision.reason,
        stageBStatus,
        stageBReason,
        routeHealthy,
        liquidityDegradePct: liqDegradePct
      },
      workflowPhase: "SCALING"
    });

    if (!decision.shouldScale) {
      if (
        !routeHealthy ||
        hasCritical ||
        stageBStatus === "timeout" ||
        (liqDegradePct ?? 0) > cfg.strategy.sniper.maxLiquidityDegradePctBeforeScale
      ) {
        repos.updatePosition({ id: position.id, status: "EXITING" } as any);
        const exitIntent: TradeIntent = {
          id: crypto.randomUUID(),
          type: "SELL",
          intentKind: "EXIT_EMERGENCY",
          mode,
          mint: position.mint,
          baseMint: position.baseMint,
          notionalUsd: 0,
          amountIn: position.currentTokenAmount > 0n ? position.currentTokenAmount : position.entryTokenAmount,
          slippageBps: cfg.execution.slippageBpsExit,
          createdAtMs: Date.now(),
          reason: `sniper_scale_reject:${decision.reason ?? stageBReason}`,
          positionId: position.id,
          candidateId: resolvedCandidateId
        };
        writeLifecycle({
          mint: position.mint,
          stage: "INTENT_CREATED",
          positionId: position.id,
          intentId: exitIntent.id,
          candidateId: resolvedCandidateId,
          meta: { type: exitIntent.type, intentKind: exitIntent.intentKind, reason: exitIntent.reason },
          workflowPhase: "EXITING"
        });
        void execQueue.add(() => executeIntent(exitIntent, latestPair));
      }
      return;
    }

    const lossBreaker = getLossBreakerStatus({ cfg, repos, mode });
    if (lossBreaker.blocked) {
      writeLifecycle({
        mint: params.mint,
        stage: "SCALE_BLOCKED",
        positionId: position.id,
        candidateId: resolvedCandidateId,
        meta: {
          reason: "loss_breaker_active",
          consecutiveLosses: lossBreaker.consecutiveLosses,
          blockedUntilMs: lossBreaker.blockedUntilMs
        },
        workflowPhase: "BLOCKED"
      });
      logger.warn(
        {
          mint: params.mint,
          positionId: position.id,
          consecutiveLosses: lossBreaker.consecutiveLosses,
          blockedUntilMs: lossBreaker.blockedUntilMs
        },
        "sniper scale blocked by consecutive-loss breaker"
      );
      return;
    }

    const baseUsd = await getBaseAssetUsdPrice();
    if (!baseUsd || baseUsd <= 0) {
      writeLifecycle({
        mint: params.mint,
        stage: "SCALE_BLOCKED",
        positionId: position.id,
        candidateId: resolvedCandidateId,
        meta: { reason: "base_asset_price_missing" },
        workflowPhase: "BLOCKED"
      });
      return;
    }
    const notionalUsd = cfg.strategy.portfolio.maxPositionNotionalUsd * (cfg.strategy.sniper.scaleEntryPct / 100);
    const amountIn = usdToBaseAssetAmount(notionalUsd, baseUsd);
    if (amountIn <= 0n) {
      writeLifecycle({
        mint: params.mint,
        stage: "SCALE_BLOCKED",
        positionId: position.id,
        candidateId: resolvedCandidateId,
        meta: { reason: "scale_amount_zero" },
        workflowPhase: "BLOCKED"
      });
      return;
    }

    const scaleIntent: TradeIntent = {
      id: crypto.randomUUID(),
      type: "BUY",
      intentKind: "ENTRY_SCALE",
      mode,
      mint: params.mint,
      baseMint: cfg.assets.baseAssetMint,
      notionalUsd,
      amountIn,
      slippageBps: cfg.execution.slippageBpsEntry,
      createdAtMs: Date.now(),
      reason: `sniper_scale:${decision.reason ?? "ok"}`,
      positionId: position.id,
      parentPositionId: position.id,
      candidateId: resolvedCandidateId
    };
    const guard = await checkRuntimeEntryRisk({
      cfg,
      repos,
      jup,
      rpc,
      logger,
      mode,
      intent: scaleIntent,
      walletPubkey: wallet?.publicKey.toBase58(),
      baseAssetUsdPrice: baseUsd,
      pendingReservedEntryUsd: mode === "live" ? entryAdmission.reservedLiveEntryUsd : 0
    });
    if (!guard.ok) {
      writeLifecycle({
        mint: params.mint,
        stage: "SCALE_BLOCKED",
        positionId: position.id,
        candidateId: resolvedCandidateId,
        meta: {
          reason: guard.reason ?? "runtime_risk_guard",
          realizedPnlUsd: guard.realizedPnlUsd,
          unrealizedPnlUsd: guard.unrealizedPnlUsd
        },
        workflowPhase: "BLOCKED"
      });
      logger.warn({ mint: params.mint, positionId: position.id, guard }, "sniper scale blocked by runtime risk guard");
      return;
    }
    const reservation = tryReserveEntryAdmission({
      state: entryAdmission,
      cfg,
      repos,
      mode,
      intent: scaleIntent,
      baseAssetUsdPrice: baseUsd,
      reserveMint: false,
      reservePositionSlot: false
    });
    if (!reservation.ok) {
      writeLifecycle({
        mint: params.mint,
        stage: "SCALE_BLOCKED",
        positionId: position.id,
        candidateId: resolvedCandidateId,
        meta: {
          reason: reservation.reason ?? "entry_admission_reservation_failed"
        },
        workflowPhase: "BLOCKED"
      });
      logger.warn(
        { mint: params.mint, positionId: position.id, reason: reservation.reason },
        "sniper scale blocked by admission reservation"
      );
      return;
    }
    emitReservedCapitalState();

    writeLifecycle({
      mint: params.mint,
      stage: "INTENT_CREATED",
      positionId: position.id,
      intentId: scaleIntent.id,
      candidateId: resolvedCandidateId,
      meta: { type: scaleIntent.type, intentKind: scaleIntent.intentKind, reason: scaleIntent.reason },
      workflowPhase: "SCALING"
    });
    void execQueue
      .add(async () => {
        try {
          await executeIntent(scaleIntent, latestPair);
        } finally {
          releaseEntryAdmission({
            state: entryAdmission,
            mint: scaleIntent.mint,
            reservedUsd: reservation.reservedUsd,
            reservedMint: reservation.reservedMint,
            reservedSlot: reservation.reservedSlot
          });
          emitReservedCapitalState();
        }
      })
      .catch((err) => {
        releaseEntryAdmission({
          state: entryAdmission,
          mint: scaleIntent.mint,
          reservedUsd: reservation.reservedUsd,
          reservedMint: reservation.reservedMint,
          reservedSlot: reservation.reservedSlot
        });
        emitReservedCapitalState();
        logger.warn({ mint: params.mint, positionId: position.id, err: String(err) }, "sniper scale execution enqueue failed");
      });
  }

  async function waitForStageBResolution(candidateId: string): Promise<{
    status: "clean" | "critical" | "failed" | "timeout";
    reason: string;
  }> {
    const maxWaitMs = Math.max(1_000, cfg.strategy.sniper.stageBMaxWaitMs);
    const pollMs = Math.max(250, cfg.strategy.sniper.stageBPollMs);
    const deadline = Date.now() + maxWaitMs;
    while (!stopSignal.aborted) {
      const flow = candidateFlow.get(candidateId);
      const status = flow?.stageBStatus ?? "pending";
      if (status === "clean" || status === "critical" || status === "failed") {
        return { status, reason: flow?.stageBReason ?? `stageb_${status}` };
      }
      if (Date.now() >= deadline) {
        return { status: "timeout", reason: "stageb_timeout" };
      }
      await sleepMs(pollMs, stopSignal).catch(() => undefined);
    }
    return { status: "failed", reason: "stageb_aborted" };
  }

  function writeLifecycle(params: {
    mint: string;
    stage: string;
    atMs?: number;
    candidateId?: string;
    positionId?: string;
    intentId?: string;
    meta?: unknown;
    workflowPhase?: WorkflowPhase;
  }): void {
    const inferredCandidateId =
      params.candidateId ??
      (params.positionId ? positionFlow.get(params.positionId)?.candidateId : undefined) ??
      mintCandidateIndex.get(params.mint);
    repos.insertLifecycleEvent({
      id: crypto.randomUUID(),
      runId,
      candidateId: inferredCandidateId,
      mint: params.mint,
      stage: params.stage,
      atMs: params.atMs ?? Date.now(),
      positionId: params.positionId,
      intentId: params.intentId,
      meta: withWorkflowPhaseMeta({
        stage: params.stage,
        meta: params.meta,
        workflowPhase: params.workflowPhase
      })
    });
  }

  function writePositionLeg(params: {
    intent: TradeIntent;
    positionId?: string;
    ok: boolean;
    txSig?: string;
    err?: string;
    inAmount?: bigint;
    outAmount?: bigint;
    raw?: unknown;
  }): void {
    const positionId = params.positionId ?? params.intent.positionId;
    if (!positionId) return;
    repos.insertPositionLeg({
      id: crypto.randomUUID(),
      positionId,
      mint: params.intent.mint,
      side: params.intent.type,
      intentKind: params.intent.intentKind,
      requestedAtMs: params.intent.createdAtMs,
      executedAtMs: Date.now(),
      ok: params.ok,
      txSig: params.txSig,
      err: params.err,
      inAmount: params.inAmount,
      outAmount: params.outAmount,
      raw: params.raw
    });
  }

  async function executeIntent(intent: TradeIntent, bestPair: DexPairSnapshot | null): Promise<void> {
    try {
      if (intent.type === "BUY") {
        if (stopSignal.aborted) return;
        if (!allowEntries) return;

        if (mode === "paper") {
          writeLifecycle({
            mint: intent.mint,
            stage: "SENT",
            positionId: intent.positionId,
            intentId: intent.id,
            meta: { mode, intentKind: intent.intentKind, type: intent.type },
            workflowPhase: "ENTERING"
          });
          const { position, execution } = await executePaperBuy({ cfg, intent, bestPair, jup, repos, logger });
          writeLifecycle({
            mint: intent.mint,
            stage: "CONFIRMED",
            positionId: position.id,
            intentId: intent.id,
            meta: {
              ok: execution.ok,
              err: execution.err,
              type: intent.type,
              intentKind: intent.intentKind,
              positionStatus: position.status,
              positionStage: position.stage
            },
            workflowPhase: execution.ok
              ? deriveWorkflowPhaseFromPosition({ status: position.status, stage: position.stage })
              : "ENTERING"
          });
          writePositionLeg({
            intent,
            positionId: position.id,
            ok: execution.ok,
            inAmount: execution.inAmount,
            outAmount: execution.outAmount,
            err: execution.err,
            raw: execution.raw
          });
          const flow = positionFlow.get(position.id);
          if (flow) flow.entryPath = "paper";
          return;
        }

        const probeRequired = cfg.probe.requiredInLive || cfg.probe.enabled;
        const probePassUntil = probePassUntilMs.get(intent.mint) ?? 0;
        if (probeRequired && Date.now() >= probePassUntil) {
          const probeBuyLamports = BigInt(cfg.probe.maxNotionalLamports);
          try {
            const probeBuy: TradeIntent = {
              ...intent,
              id: crypto.randomUUID(),
              type: "BUY",
              mode: "live",
              notionalUsd: 0,
              amountIn: probeBuyLamports,
              slippageBps: Math.min(intent.slippageBps, cfg.execution.slippageBpsEntry),
              createdAtMs: Date.now(),
              reason: "probe_buy",
              positionId: undefined
            };
            const probeBuyExec = await executeLiveBuy({
              cfg,
              intent: probeBuy,
              wallet: wallet!,
              rpc,
              jup,
              repos,
              logger
            });
            if (!probeBuyExec.ok || !probeBuyExec.outAmount || probeBuyExec.outAmount <= 0n) {
              throw new Error("probe_buy_failed");
            }
            const probeSell: TradeIntent = {
              id: crypto.randomUUID(),
              type: "SELL",
              intentKind: "EXIT_EMERGENCY",
              mode: "live",
              mint: intent.mint,
              baseMint: cfg.assets.baseAssetMint,
              notionalUsd: 0,
              amountIn: probeBuyExec.outAmount,
              slippageBps: cfg.execution.slippageBpsExit,
              createdAtMs: Date.now(),
              reason: "probe_sell"
            };
            const probeSellExec = await executeLiveSell({
              cfg,
              intent: probeSell,
              wallet: wallet!,
              rpc,
              jup,
              repos,
              logger
            });
            if (!probeSellExec.ok) throw new Error("probe_sell_failed");
            probePassUntilMs.set(intent.mint, Date.now() + cfg.probe.successCacheMinutes * 60_000);
          } catch (err) {
            const expiresAt = Date.now() + cfg.probe.cooldownMinutesOnFailure * 60_000;
            repos.setBlock({ mint: intent.mint, reason: `probe_failed:${String(err)}`, expiresAtMs: expiresAt });
            writeLifecycle({
              mint: intent.mint,
              stage: "ENTRY_BLOCKED",
              positionId: intent.positionId,
              intentId: intent.id,
              meta: {
                reason: `probe_failed:${String(err)}`,
                expiresAtMs: expiresAt
              },
              workflowPhase: "BLOCKED"
            });
            logger.warn({ mint: intent.mint, err: String(err), expiresAt }, "probe failed; mint blocked");
            return;
          }
        }

        writeLifecycle({
          mint: intent.mint,
          stage: "SENT",
          positionId: intent.positionId,
          intentId: intent.id,
          meta: { mode, intentKind: intent.intentKind, type: intent.type },
          workflowPhase: "ENTERING"
        });
        const routed = await executeRoutedLiveBuy({
          cfg,
          intent,
          bestPair,
          wallet: wallet!,
          rpc,
          jup,
          raydium,
          repos,
          logger
        });
        const exec = routed.execution;
        const buyConfirmMeta: Record<string, unknown> = {
          ok: exec.ok,
          err: exec.err,
          type: intent.type,
          intentKind: intent.intentKind,
          entryPath: routed.entryPath,
          fallbackReason:
            routed.entryPath === "jupiter_fallback" && exec.raw && typeof exec.raw === "object"
              ? (exec.raw as any)?.router?.fallbackReason
              : undefined
        };
        let buyConfirmedPhase: WorkflowPhase = "ENTERING";

        if (exec.ok && exec.outAmount && exec.outAmount > BigInt(cfg.execution.positionDustAtoms)) {
          const existing = intent.positionId ? repos.getPositionById(intent.positionId) : null;
          if (existing && existing.status !== "CLOSED") {
            const nextEntryBase = existing.entryBaseAmount + (exec.inAmount ?? intent.amountIn);
            const nextEntryToken = existing.entryTokenAmount + exec.outAmount;
            const nextCurrent = existing.currentTokenAmount + exec.outAmount;
            repos.updatePosition({
              id: existing.id,
              status: "OPEN",
              stage: "SCALED",
              sniperMode: true,
              entryBaseAmount: nextEntryBase as any,
              entryTokenAmount: nextEntryToken as any,
              currentTokenAmount: nextCurrent,
              entryTx: exec.signature
            } as any);
          } else {
            repos.createPosition({
              id: intent.positionId!,
              mint: intent.mint,
              mode: "live",
              status: "OPEN",
              stage: intent.intentKind === "ENTRY_TEST" ? "TEST" : "FULL",
              sniperMode: intent.intentKind === "ENTRY_TEST",
              tpStep: 0,
              openedAtMs: Date.now(),
              baseMint: intent.baseMint,
              entryBaseAmount: exec.inAmount ?? intent.amountIn,
              entryTokenAmount: exec.outAmount,
              initialTokenAmount: exec.outAmount,
              currentTokenAmount: exec.outAmount,
              entryTx: exec.signature,
              entryPriceUsd: bestPair?.priceUsd ? Number(bestPair.priceUsd) : undefined,
              maxSeenPriceUsd: bestPair?.priceUsd ? Number(bestPair.priceUsd) : undefined
            });
          }
          if (intent.positionId) {
            const flow = positionFlow.get(intent.positionId);
            if (flow) {
              flow.entryPath = routed.entryPath;
              const candidateState = flow.candidateId ? candidateFlow.get(flow.candidateId) : undefined;
              flow.stageBFlags = candidateState?.stageBReport?.flags;
            }
          }
          if (intent.positionId) {
            const updated = repos.getPositionById(intent.positionId);
            if (updated) {
              buyConfirmMeta.positionStatus = updated.status;
              buyConfirmMeta.positionStage = updated.stage;
              buyConfirmedPhase = deriveWorkflowPhaseFromPosition({
                status: updated.status,
                stage: updated.stage
              });
            }
          }
        } else if (exec.ok) {
          buyConfirmMeta.dustOutput = true;
          logger.warn({ mint: intent.mint, outAmount: exec.outAmount?.toString() }, "buy execution had dust output; position not opened");
        }
        writeLifecycle({
          mint: intent.mint,
          stage: "CONFIRMED",
          positionId: intent.positionId,
          intentId: intent.id,
          meta: buyConfirmMeta,
          workflowPhase: buyConfirmedPhase
        });
        writePositionLeg({
          intent,
          positionId: intent.positionId,
          ok: exec.ok,
          txSig: exec.signature,
          err: exec.err,
          inAmount: exec.inAmount,
          outAmount: exec.outAmount,
          raw: exec.raw
        });
        return;
      }

      const pos = intent.positionId ? repos.getPositionById(intent.positionId) : repos.getOpenPositionByMint(intent.mint);
      if (!pos) return;

      if (mode === "live") {
        const defer = sell429Breaker.shouldDeferSell(intent.mint, Date.now());
        if (defer.defer) {
          repos.updatePosition({ id: pos.id, status: "EXITING" } as any);
          emitSell429State(Date.now());
          logger.warn(
            { mint: intent.mint, positionId: pos.id, reason: defer.reason, retryAtMs: defer.retryAtMs },
            "sell deferred by 429 breaker"
          );
          return;
        }
      }

      let currentPair: DexPairSnapshot | null = bestPair;
      try {
        const pairs = await dex.getTokenPairs(intent.mint, stopSignal);
        currentPair = dex.selectBestPair({
          pairs,
          minLiquidityUsd: 0,
          dexAllowlist: cfg.discovery.dexAllowlist,
          preferMints: [cfg.assets.baseAssetMint, cfg.assets.quoteAssetMint]
        });
      } catch {
        // ignore
      }
      repos.insertSnapshot({ mint: intent.mint, capturedAtMs: Date.now(), pair: currentPair });

      writeLifecycle({
        mint: intent.mint,
        stage: "SENT",
        positionId: pos.id,
        intentId: intent.id,
        meta: { mode, intentKind: intent.intentKind, type: intent.type, amountIn: intent.amountIn.toString() },
        workflowPhase: "EXITING"
      });

      if (mode === "paper") {
        const baseUsd = await getBaseAssetUsdPrice();
        const execution = await executePaperSell({
          cfg,
          position: pos,
          intent,
          amountIn: intent.amountIn,
          bestPair: currentPair,
          jup,
          repos,
          logger,
          baseAssetUsdPrice: baseUsd,
          reason: intent.reason
        });
        const updated = repos.getPositionById(pos.id);
        writeLifecycle({
          mint: intent.mint,
          stage: "CONFIRMED",
          positionId: pos.id,
          intentId: intent.id,
          meta: {
            ok: execution.ok,
            err: execution.err,
            type: intent.type,
            intentKind: intent.intentKind,
            positionStatus: updated?.status,
            positionStage: updated?.stage
          },
          workflowPhase: updated
            ? deriveWorkflowPhaseFromPosition({ status: updated.status, stage: updated.stage })
            : "EXITING"
        });
        writePositionLeg({
          intent,
          positionId: pos.id,
          ok: execution.ok,
          err: execution.err,
          inAmount: execution.inAmount,
          outAmount: execution.outAmount,
          raw: execution.raw
        });
        if (updated?.status === "CLOSED") {
          await writeAttributionIfClosed(updated);
          writeLifecycle({
            mint: intent.mint,
            stage: "CLOSED",
            positionId: updated.id,
            intentId: intent.id,
            workflowPhase: "CLOSED"
          });
        }
        return;
      }

      if (intent.amountIn <= BigInt(cfg.execution.positionDustAtoms)) {
        repos.updatePosition({
          id: pos.id,
          status: "CLOSED",
          closedAtMs: Date.now(),
          pnlUsd: undefined,
          currentTokenAmount: 0n
        } as any);
        repos.insertExecution({
          id: crypto.randomUUID(),
          intentId: intent.id,
          positionId: pos.id,
          mint: intent.mint,
          side: "SELL",
          mode: "live",
          requestedAtMs: intent.createdAtMs,
          executedAtMs: Date.now(),
          ok: true,
          err: "dust_position_closed",
          inAmount: intent.amountIn,
          outAmount: 0n,
          slippageBps: intent.slippageBps,
          raw: { reason: intent.reason, note: "closed_without_swap_due_to_dust" }
        });
        writeLifecycle({
          mint: intent.mint,
          stage: "CONFIRMED",
          positionId: pos.id,
          intentId: intent.id,
          meta: {
            ok: true,
            dustClose: true,
            type: intent.type,
            intentKind: intent.intentKind,
            positionStatus: "CLOSED"
          },
          workflowPhase: "CLOSED"
        });
        writePositionLeg({
          intent,
          positionId: pos.id,
          ok: true,
          inAmount: intent.amountIn,
          outAmount: 0n,
          err: "dust_position_closed"
        });
        const closed = repos.getPositionById(pos.id);
        if (closed?.status === "CLOSED") {
          await writeAttributionIfClosed(closed);
          writeLifecycle({
            mint: intent.mint,
            stage: "CLOSED",
            positionId: closed.id,
            intentId: intent.id,
            workflowPhase: "CLOSED"
          });
        }
        return;
      }

      const exec = await executeLiveSell({ cfg, intent, wallet: wallet!, rpc, jup, repos, logger });
      writePositionLeg({
        intent,
        positionId: pos.id,
        ok: exec.ok,
        txSig: exec.signature,
        err: exec.err,
        inAmount: exec.inAmount,
        outAmount: exec.outAmount,
        raw: exec.raw
      });
      const sellConfirmMeta: Record<string, unknown> = {
        ok: exec.ok,
        err: exec.err,
        type: intent.type,
        intentKind: intent.intentKind
      };
      let sellConfirmedPhase: WorkflowPhase = "EXITING";

      if (exec.ok && exec.outAmount && exec.outAmount >= 0n) {
        sell429Breaker.recordSellSuccess(intent.mint);
        emitSell429State(Date.now());
        const sold = exec.inAmount ?? intent.amountIn;
        const current = pos.currentTokenAmount > 0n ? pos.currentTokenAmount : pos.entryTokenAmount;
        const remaining = sold >= current ? 0n : current - sold;
        const cumulativeExitBase = (pos.exitBaseAmount ?? 0n) + exec.outAmount;
        const nextTpStep = Math.max(
          pos.tpStep,
          intent.intentKind === "EXIT_TP1" ? 1 : intent.intentKind === "EXIT_TP2" ? 2 : intent.intentKind === "EXIT_TP3" ? 3 : pos.tpStep
        );
        const isClosed = remaining <= BigInt(cfg.execution.positionDustAtoms);
        const nextStatus = isClosed ? "CLOSED" : isFullExitIntentKind(intent.intentKind) ? "EXITING" : "OPEN";
        let pnlUsd: number | undefined;
        if (isClosed) {
          const baseUsd = await getBaseAssetUsdPrice();
          if (baseUsd && baseUsd > 0) {
            const pnlLamports = cumulativeExitBase - pos.entryBaseAmount;
            pnlUsd = lamportsToUsd(pnlLamports, baseUsd);
          }
        }
        repos.updatePosition({
          id: pos.id,
          status: nextStatus,
          closedAtMs: isClosed ? Date.now() : undefined,
          exitBaseAmount: cumulativeExitBase as any,
          exitTx: exec.signature,
          exitPriceUsd: currentPair?.priceUsd ? Number(currentPair.priceUsd) : undefined,
          pnlUsd,
          currentTokenAmount: remaining,
          tpStep: nextTpStep
        } as any);
        const updated = repos.getPositionById(pos.id);
        if (updated) {
          sellConfirmMeta.positionStatus = updated.status;
          sellConfirmMeta.positionStage = updated.stage;
          sellConfirmedPhase = deriveWorkflowPhaseFromPosition({
            status: updated.status,
            stage: updated.stage
          });
        }
        writeLifecycle({
          mint: intent.mint,
          stage: "CONFIRMED",
          positionId: pos.id,
          intentId: intent.id,
          meta: sellConfirmMeta,
          workflowPhase: sellConfirmedPhase
        });
        if (updated?.status === "CLOSED") {
          await writeAttributionIfClosed(updated);
          writeLifecycle({
            mint: intent.mint,
            stage: "CLOSED",
            positionId: updated.id,
            intentId: intent.id,
            workflowPhase: "CLOSED"
          });
        }
      } else {
        if (exec.ok) {
          logger.warn({ mint: intent.mint }, "sell execution missing out amount; keeping EXITING");
        } else if (isJupiterRateLimitError(exec.err)) {
          const breaker = sell429Breaker.recordSell429(intent.mint, Date.now());
          emitSell429State(Date.now());
          logger.warn(
            { mint: intent.mint, mintRetryAtMs: breaker.mintRetryAtMs, globalRetryAtMs: breaker.globalRetryAtMs },
            "sell failed due to Jupiter rate limit; breaker cooldown applied"
          );
        }
        repos.updatePosition({ id: pos.id, status: "EXITING" } as any);
        sellConfirmMeta.positionStatus = "EXITING";
        writeLifecycle({
          mint: intent.mint,
          stage: "CONFIRMED",
          positionId: pos.id,
          intentId: intent.id,
          meta: sellConfirmMeta,
          workflowPhase: "EXITING"
        });
      }
    } catch (err) {
      logger.warn({ intentId: intent.id, mint: intent.mint, err: String(err) }, "intent execution failed");
      if (intent.type === "SELL" && intent.positionId) {
        if (isJupiterRateLimitError(err)) {
          const breaker = sell429Breaker.recordSell429(intent.mint, Date.now());
          emitSell429State(Date.now());
          logger.warn(
            { mint: intent.mint, mintRetryAtMs: breaker.mintRetryAtMs, globalRetryAtMs: breaker.globalRetryAtMs },
            "sell execution error matched Jupiter rate limit; breaker cooldown applied"
          );
        }
        repos.updatePosition({ id: intent.positionId, status: "EXITING" } as any);
      }
      writeLifecycle({
        mint: intent.mint,
        stage: "CONFIRMED",
        positionId: intent.positionId,
        intentId: intent.id,
        meta: {
          ok: false,
          err: String(err),
          type: intent.type,
          intentKind: intent.intentKind,
          positionStatus: intent.type === "SELL" ? "EXITING" : "ENTERING"
        },
        workflowPhase: intent.type === "SELL" ? "EXITING" : "ENTERING"
      });
    }
  }

  async function writeAttributionIfClosed(position: Position): Promise<void> {
    if (position.status !== "CLOSED" || !position.closedAtMs) return;
    const flow = positionFlow.get(position.id);
    const holdMs = Math.max(0, position.closedAtMs - position.openedAtMs);
    repos.insertTradeAttribution({
      id: crypto.randomUUID(),
      positionId: position.id,
      mint: position.mint,
      mode: position.mode,
      openedAtMs: position.openedAtMs,
      closedAtMs: position.closedAtMs,
      holdMs,
      pnlUsd: position.pnlUsd,
      features: {
        candidateId: flow?.candidateId,
        detectSource: flow?.source ?? "unknown",
        entryPath: flow?.entryPath ?? "unknown",
        stageAFlags: flow?.stageAFlags ?? [],
        stageBFlags: flow?.stageBFlags ?? [],
        detectToAnalyzeMs:
          flow?.detectAtMs !== undefined && flow?.analyzeAAtMs !== undefined ? flow.analyzeAAtMs - flow.detectAtMs : undefined,
        analyzeToIntentMs:
          flow?.analyzeAAtMs !== undefined && flow?.intentAtMs !== undefined ? flow.intentAtMs - flow.analyzeAAtMs : undefined
      }
    });
  }

  // Start guardian
  void guardianLoop({
    cfg,
    repos,
    dex,
    jup,
    rpc,
    logger,
    mode,
    stopSignal,
    handlers: {
      onExitIntent: (intent) => execQueue.add(() => executeIntent(intent, null))
    },
    baseAssetUsdPrice: () => null,
    walletPubkey: wallet?.publicKey.toBase58()
  }).catch((err) => logger.warn({ err: String(err) }, "guardian died"));

  // Start discovery: stream primary with DexScreener fallback.
  let streamHandle: Awaited<ReturnType<typeof startStreamDiscovery>> | null = null;
  if (cfg.discovery.stream.enabled && env.heliusWsUrl) {
    try {
      const stream = new HeliusStreamClient(
        {
          rpcHttpUrl: env.rpcUrl,
          wsUrl: env.heliusWsUrl,
          commitment: "confirmed"
        },
        logger
      );
      streamHandle = await startStreamDiscovery({
        cfg,
        rpc,
        stream,
        repos,
        logger,
        handlers: {
          onCandidate: ({ mint, source, detectedAtMs, txSig, candidateId, eventKind, confidence, parsePath, reason }) =>
            enqueueAnalysis(mint, null, source, detectedAtMs, txSig, candidateId, {
              eventKind,
              confidence,
              parsePath,
              reason
            })
        },
        stopSignal
      });
      streamState.connected = true;
      streamState.stale = false;
      streamState.fallbackActive = false;
      streamState.lastEventAtMs = Date.now();
      emitStreamState();
      logger.info("stream discovery enabled");
    } catch (err) {
      streamState.connected = false;
      streamState.stale = true;
      streamState.fallbackActive = true;
      emitStreamState();
      logger.warn({ err: String(err) }, "stream discovery failed to start; using fallback polling only");
    }
  } else if (cfg.discovery.stream.enabled) {
    streamState.connected = false;
    streamState.stale = true;
    streamState.fallbackActive = true;
    emitStreamState();
    logger.warn("stream discovery enabled in config but HELIUS_WS_URL missing; using fallback polling");
  } else {
    streamState.connected = false;
    streamState.stale = false;
    streamState.fallbackActive = true;
    emitStreamState();
  }

  let fallbackActive = streamHandle === null;
  streamState.fallbackActive = fallbackActive;
  emitStreamState();
  void discoveryLoop({
    cfg,
    dex,
    repos,
    logger,
    handlers: {
      onCandidate: ({ mint, bestPair, source, detectedAtMs, txSig, candidateId }) =>
        enqueueAnalysis(mint, bestPair, source, detectedAtMs, txSig, candidateId)
    },
    stopSignal,
    fallbackOnly: streamHandle !== null,
    pollIntervalMs: cfg.discovery.fallbackPollIntervalMs,
    shouldRunFallback: () => {
      if (!streamHandle) return true;
      const lastEvent = streamHandle.lastEventAtMs();
      const stale = lastEvent <= 0 || Date.now() - lastEvent > cfg.discovery.stream.staleFailoverMs;
      streamState.lastEventAtMs = lastEvent > 0 ? lastEvent : 0;
      streamState.stale = stale;
      streamState.connected = !stale;
      if (stale !== fallbackActive) {
        fallbackActive = stale;
        streamState.fallbackActive = stale;
        emitStreamState();
        logger.warn(
          {
            stale,
            lastEventAtMs: lastEvent > 0 ? lastEvent : null,
            staleFailoverMs: cfg.discovery.stream.staleFailoverMs
          },
          stale ? "stream stale; fallback polling active" : "stream recovered; fallback polling idle"
        );
      }
      if (streamState.fallbackActive !== stale) {
        streamState.fallbackActive = stale;
      }
      return stale;
    }
  }).catch((err) => logger.warn({ err: String(err) }, "discovery died"));

  const dashboardHeartbeatMs = 2_000;
  const walletHeartbeatMs = 4_000;
  const capitalHeartbeatMs = 15_000;
  let nextWalletAtMs = 0;
  let nextCapitalAtMs = 0;
  const dashboardTimer = setInterval(() => {
    if (stopSignal.aborted) return;
    const nowMs = Date.now();
    emitStreamState();
    emitSell429State(nowMs);
    if (nowMs >= nextWalletAtMs) {
      nextWalletAtMs = nowMs + walletHeartbeatMs;
      void emitWalletBalanceState(nowMs).catch((err) =>
        logger.debug({ err: String(err) }, "wallet balance state emit failed")
      );
    }
    if (nowMs >= nextCapitalAtMs) {
      nextCapitalAtMs = nowMs + capitalHeartbeatMs;
      void emitCapitalState(nowMs).catch((err) =>
        logger.debug({ err: String(err) }, "capital state emit failed")
      );
    }
  }, dashboardHeartbeatMs);
  dashboardTimer.unref?.();
  stopSignal.addEventListener(
    "abort",
    () => {
      clearInterval(dashboardTimer);
    },
    { once: true }
  );

  // Keep process alive until aborted
  while (!stopSignal.aborted) {
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (stopTimer) clearTimeout(stopTimer);

  logger.info("shutdown: waiting for queues");
  const execDrainTimeoutMs = Math.min(20_000, cfg.execution.confirmTimeoutMs + 5_000);
  await waitForQueueDrain("execution", execQueue, execDrainTimeoutMs, logger);
  await waitForQueueDrain("analysis", analysisQueue, 10_000, logger);
  if (streamHandle) {
    await streamHandle.stop().catch((err) => logger.debug({ err: String(err) }, "stream stop failed"));
  }
  db.close();
}

export async function analyzeOnce(params: {
  cfg: AppConfig;
  env: RuntimeEnv;
  logger: Logger;
  mint: string;
}): Promise<{ reportJson: string }> {
  const { cfg, env, logger, mint } = params;

  const db = openSqlite(env.dbPath);
  runMigrations(db);
  const repos = createRepos(db);
  const dex = new DexScreenerClient(env.dexScreenerBaseUrl, logger);
  const jup = new JupiterUltraClient(env.jupBaseUrl, env.jupApiKey, logger);
  const rpc = new SolanaRpc(env.rpcUrl, {
    commitment: "confirmed",
    concurrency: env.rpcConcurrency,
    intervalCap: env.rpcIntervalCap,
    intervalMs: env.rpcIntervalMs
  });

  let bestPair: DexPairSnapshot | null = null;
  try {
    const pairs = await dex.getTokenPairs(mint);
    bestPair = dex.selectBestPair({
      pairs,
      minLiquidityUsd: 0,
      dexAllowlist: cfg.discovery.dexAllowlist,
      preferMints: [cfg.assets.baseAssetMint, cfg.assets.quoteAssetMint]
    });
  } catch {
    // ignore
  }

  const mode: "paper" | "live" = env.liveTradingEnabled ? "live" : "paper";
  const report = await analyzeToken({ cfg, mint, bestPair, rpc, jup, repos, logger, mode });
  repos.insertSnapshot({ mint, capturedAtMs: Date.now(), pair: bestPair });
  repos.insertRiskReport(report);
  db.close();
  return { reportJson: JSON.stringify(report, null, 2) };
}

function isRateOrTimeoutError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("aborted")
  );
}

async function waitForQueueDrain(name: string, queue: PQueue, timeoutMs: number, logger: Logger): Promise<void> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
    timeoutHandle.unref?.();
  });
  const winner = await Promise.race([queue.onIdle().then(() => "idle" as const), timeout]);
  if (timeoutHandle) clearTimeout(timeoutHandle);

  if (winner === "timeout" && (queue.pending > 0 || queue.size > 0)) {
    logger.warn({ name, pending: queue.pending, queued: queue.size, timeoutMs }, "queue drain timeout reached");
  }
}

function hasCriticalStageBFlags(flags: string[]): boolean {
  const critical = new Set([
    "EXIT_ROUTE_GONE",
    "LIQUIDITY_DRAIN",
    "SUPPLY_INCREASED",
    "DEV_DUMPING",
    "NO_EXIT_ROUTE",
    "PROBE_FAILED"
  ]);
  return flags.some((f) => critical.has(f));
}

function usdToBaseAssetAmount(usd: number, baseAssetUsd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(baseAssetUsd) || baseAssetUsd <= 0) return 0n;
  const sol = usd / baseAssetUsd;
  const lamports = Math.floor(sol * 1_000_000_000);
  return lamports > 0 ? BigInt(lamports) : 0n;
}

function lamportsToUsd(lamports: bigint, baseAssetUsd: number): number {
  if (!Number.isFinite(baseAssetUsd) || baseAssetUsd <= 0) return 0;
  return lamportsToUsdNumber(lamports, baseAssetUsd);
}

function isFullExitIntentKind(kind: TradeIntent["intentKind"]): boolean {
  return kind === "EXIT_STOP" || kind === "EXIT_TIME" || kind === "EXIT_EMERGENCY" || kind === "EXIT_TP3";
}

function setupSignalHandlers(logger: Logger, abort: AbortController): void {
  const onSig = (sig: string) => {
    logger.warn({ sig }, "received signal; stopping");
    abort.abort();
  };
  process.on("SIGINT", () => onSig("SIGINT"));
  process.on("SIGTERM", () => onSig("SIGTERM"));
}
