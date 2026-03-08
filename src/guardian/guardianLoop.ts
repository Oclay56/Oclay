import crypto from "node:crypto";
import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { Repos } from "../storage/repos";
import type { DexScreenerClient } from "../providers/dexscreener";
import type { JupiterUltraClient } from "../providers/jupiterUltra";
import type { SolanaRpc } from "../providers/solanaRpc";
import type { TradeIntent } from "../domain/types";
import { computeExitSignal } from "../strategy/stateMachine";
import { sleepMs } from "../utils/time";
import { resolveLiveExitAmount, type ResolvedExitAmount } from "../execution/exitSizing";
import { classifyRouteCheckError } from "../utils/errors";

export interface GuardianHandlers {
  onExitIntent: (intent: TradeIntent) => void;
}

export async function guardianLoop(params: {
  cfg: AppConfig;
  repos: Repos;
  dex: DexScreenerClient;
  jup: JupiterUltraClient;
  rpc: SolanaRpc;
  logger: Logger;
  mode: "paper" | "live";
  stopSignal: AbortSignal;
  handlers: GuardianHandlers;
  baseAssetUsdPrice: () => number | null;
  walletPubkey?: string;
}): Promise<void> {
  const { cfg, repos, dex, jup, rpc, logger, mode, stopSignal, handlers, baseAssetUsdPrice, walletPubkey } = params;
  const recentExitIntentAt = new Map<string, number>();

  while (!stopSignal.aborted) {
    const nowMs = Date.now();
    try {
      const positions = repos.getOpenPositions();
      for (const p of positions) {
        if (stopSignal.aborted) break;
        const prevSnap = repos.getLatestSnapshot(p.mint);

        // Fetch market data
        let bestPair = null;
        try {
          const pairs = await dex.getTokenPairs(p.mint, stopSignal);
          bestPair = dex.selectBestPair({
            pairs,
            minLiquidityUsd: 0,
            dexAllowlist: cfg.discovery.dexAllowlist,
            preferMints: [cfg.assets.baseAssetMint, cfg.assets.quoteAssetMint]
          });
        } catch (err) {
          logger.debug({ mint: p.mint, err: String(err) }, "guardian: failed to fetch pairs");
        }

        const currentPriceUsd = bestPair?.priceUsd ? Number(bestPair.priceUsd) : null;
        const exitSig = computeExitSignal(cfg, p, currentPriceUsd, nowMs);
        if (exitSig.updatedMaxSeenPriceUsd !== undefined) {
          repos.updatePosition({ id: p.id, maxSeenPriceUsd: exitSig.updatedMaxSeenPriceUsd } as any);
        }

        let resolvedExitAmount = p.currentTokenAmount > 0n ? p.currentTokenAmount : p.entryTokenAmount;
        let resolvedLiveExit: ResolvedExitAmount | undefined;
        let exitSizingReason = "tracked_entry_amount";
        if (mode === "live" && walletPubkey) {
          const resolved = await resolveLiveExitAmount({
            cfg,
            rpc,
            wallet: walletPubkey,
            position: p
          });
          resolvedLiveExit = resolved;
          exitSizingReason = resolved.reason;
          if (!resolved.lookupOk) {
            logger.warn({ mint: p.mint, positionId: p.id, exitSizingReason }, "guardian: live exit sizing unavailable; skipping cycle");
            continue;
          }
          resolvedExitAmount = resolved.availableAmount;
          if (resolved.availableAmount <= BigInt(cfg.execution.positionDustAtoms)) {
            repos.updatePosition({
              id: p.id,
              status: "CLOSED",
              closedAtMs: Date.now(),
              pnlUsd: undefined,
              currentTokenAmount: 0n
            } as any);
            repos.insertExecution({
              id: crypto.randomUUID(),
              intentId: crypto.randomUUID(),
              positionId: p.id,
              mint: p.mint,
              side: "SELL",
              mode,
              requestedAtMs: Date.now(),
              executedAtMs: Date.now(),
              ok: true,
              err: "dust_position_closed",
              inAmount: 0n,
              outAmount: 0n,
              slippageBps: cfg.execution.slippageBpsExit,
              raw: { reason: "guardian_dust_close", exitSizingReason }
            });
            logger.warn({ mint: p.mint, positionId: p.id, exitSizingReason }, "guardian: closed dust/de-risked position");
            continue;
          }
        }

        // Critical risk: route disappeared for full position size
        let routeGone = false;
        let routeCheckClass: "semantic_no_route" | "transient" | "unknown" | "ok" = "ok";
        try {
          await jup.getOrder({
            inputMint: p.mint,
            outputMint: cfg.assets.baseAssetMint,
            amount: resolvedExitAmount.toString(),
            slippageBps: cfg.execution.slippageBpsExit,
            signal: stopSignal
          });
        } catch (err) {
          routeCheckClass = classifyRouteCheckError(err);
          if (routeCheckClass === "semantic_no_route") {
            routeGone = true;
          } else {
            logger.debug(
              { mint: p.mint, positionId: p.id, routeCheckClass, err: String(err) },
              "guardian: non-semantic route check failure"
            );
          }
        }

        // Critical risk: supply increased
        let supplyIncreased = false;
        try {
          const prev = repos.getLatestRiskReport(p.mint);
          const prevSupply = prev?.metrics?.mintSafety?.supplyAmount ? BigInt(String(prev.metrics.mintSafety.supplyAmount)) : undefined;
          const curSupply = BigInt((await rpc.getTokenSupply(p.mint)).value.amount);
          if (prevSupply && prevSupply > 0n && curSupply > (prevSupply * 1005n) / 1000n) supplyIncreased = true;
        } catch {
          // ignore
        }

        // Critical risk: liquidity drain vs previous snapshot
        let liquidityDrain = false;
        try {
          const prevLiq = prevSnap?.liquidityUsd ?? null;
          const curLiq = bestPair?.liquidityUsd ?? null;
          if (prevLiq && curLiq !== null && prevLiq > 0) {
            const drainPct = ((prevLiq - curLiq) / prevLiq) * 100;
            if (drainPct >= cfg.guardian.liquidityDrainPct) liquidityDrain = true;
          }
        } catch {
          // ignore
        }

        // Critical risk: abrupt short-term volume collapse vs previous snapshot
        let volumeDrop = false;
        try {
          const prevVolM5 = prevSnap?.volumeM5Usd ?? null;
          const curVolM5 = bestPair?.volume?.m5 ?? null;
          if (
            prevVolM5 !== null &&
            curVolM5 !== null &&
            prevVolM5 >= cfg.guardian.minPreviousVolumeM5Usd &&
            prevVolM5 > 0
          ) {
            const dropPct = ((prevVolM5 - curVolM5) / prevVolM5) * 100;
            if (dropPct >= cfg.guardian.volumeDropM5Pct) volumeDrop = true;
          }
        } catch {
          // ignore
        }

        // Strategy exit: price is approaching historical supply zone
        const supplyZoneTouched = detectSupplyZoneTouch({
          cfg,
          repos,
          mint: p.mint,
          nowMs,
          currentPriceUsd
        });

        // Persist the latest view for audit/guardian diffs.
        repos.insertSnapshot({ mint: p.mint, capturedAtMs: nowMs, pair: bestPair });

        const shouldExit =
          exitSig.shouldExit ||
          supplyZoneTouched ||
          routeGone ||
          supplyIncreased ||
          liquidityDrain ||
          volumeDrop ||
          p.status === "EXITING";

        if (!shouldExit) continue;

        const reasons: string[] = [];
        if (exitSig.shouldExit) reasons.push(exitSig.reason ?? "strategy_exit");
        if (routeGone) reasons.push("exit_route_gone");
        if (!routeGone && routeCheckClass !== "ok") reasons.push(`route_check_${routeCheckClass}`);
        if (supplyIncreased) reasons.push("supply_increased");
        if (liquidityDrain) reasons.push("liquidity_drain");
        if (volumeDrop) reasons.push("volume_drop_m5");
        if (supplyZoneTouched) reasons.push("supply_zone_touch");

        if (p.status !== "EXITING") {
          repos.updatePosition({ id: p.id, status: "EXITING" } as any);
        }

        const lastIntentAt = recentExitIntentAt.get(p.id) ?? 0;
        if (nowMs - lastIntentAt < cfg.guardian.intervalMs) continue;

        const effectiveExitKind = supplyZoneTouched ? "TIME" : exitSig.exitKind;
        const effectiveSellPct = supplyZoneTouched ? 100 : exitSig.sellPct;
        const emergencyTriggered = routeGone || supplyIncreased || liquidityDrain || volumeDrop;
        const liveSellableAmount =
          mode === "live" && resolvedLiveExit
            ? selectLiveExitSellableAmount({
                resolved: resolvedLiveExit,
                exitKind: effectiveExitKind,
                emergencyTriggered
              })
            : undefined;
        const amountIn = computeGuardianSellAmount({
          availableAmount:
            mode === "live"
              ? liveSellableAmount ?? resolvedExitAmount
              : p.currentTokenAmount > 0n
                ? p.currentTokenAmount
                : p.entryTokenAmount,
          currentTrackedAmount: p.currentTokenAmount > 0n ? p.currentTokenAmount : p.entryTokenAmount,
          initialAmount: p.initialTokenAmount > 0n ? p.initialTokenAmount : p.entryTokenAmount,
          sellPct: effectiveSellPct,
          exitKind: effectiveExitKind,
          ladderPercents: cfg.strategy.exits.tpLadderPercents
        });
        if (amountIn <= BigInt(cfg.execution.positionDustAtoms)) {
          logger.debug(
            { mint: p.mint, positionId: p.id, amountIn: amountIn.toString(), reason: reasons.join("; ") },
            "guardian: computed sell amount is dust; skipping sell intent"
          );
          continue;
        }

        const intent: TradeIntent = {
          id: crypto.randomUUID(),
          type: "SELL",
          intentKind: selectGuardianExitIntentKind(effectiveExitKind, emergencyTriggered),
          mode,
          mint: p.mint,
          baseMint: cfg.assets.baseAssetMint,
          notionalUsd: 0,
          amountIn,
          slippageBps: cfg.execution.slippageBpsExit,
          createdAtMs: Date.now(),
          reason: `${reasons.join("; ")}; ${exitSizingReason}`,
          positionId: p.id
        };

        logger.warn({ mint: p.mint, positionId: p.id, reason: intent.reason }, "guardian: exit triggered");
        recentExitIntentAt.set(p.id, nowMs);
        handlers.onExitIntent(intent);
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "guardian loop error");
    }

    await sleepMs(cfg.guardian.intervalMs, stopSignal);
  }
}

function detectSupplyZoneTouch(params: {
  cfg: AppConfig;
  repos: Repos;
  mint: string;
  nowMs: number;
  currentPriceUsd: number | null;
}): boolean {
  const { cfg, repos, mint, nowMs, currentPriceUsd } = params;
  if (!currentPriceUsd || currentPriceUsd <= 0) return false;

  const lookbackMinutes = Math.max(1, Math.floor(cfg.strategy.exits.supplyZoneLookbackMinutes));
  const sinceMs = nowMs - lookbackMinutes * 60_000;
  const minSnapshots = Math.max(2, Math.floor(cfg.strategy.exits.supplyZoneMinSnapshots));
  const historical = repos
    .getRecentSnapshotsByMint({ mint, sinceMs, limit: 300 })
    .map((s) => s.priceUsd)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (historical.length < minSnapshots) return false;

  const historicalHigh = Math.max(...historical);
  const bandPct = Math.max(0, cfg.strategy.exits.supplyZoneBandPct);
  const supplyFloor = historicalHigh * (1 - bandPct / 100);
  return currentPriceUsd >= supplyFloor;
}

export function selectGuardianExitIntentKind(
  kind: "TP1" | "TP2" | "TP3" | "STOP" | "TIME" | "EMERGENCY" | undefined,
  emergencyTriggered: boolean
): TradeIntent["intentKind"] {
  if (emergencyTriggered) return "EXIT_EMERGENCY";
  switch (kind) {
    case "TP1":
      return "EXIT_TP1";
    case "TP2":
      return "EXIT_TP2";
    case "TP3":
      return "EXIT_TP3";
    case "TIME":
      return "EXIT_TIME";
    case "EMERGENCY":
      return "EXIT_EMERGENCY";
    case "STOP":
    default:
      return "EXIT_STOP";
  }
}

export function computeGuardianSellAmount(params: {
  availableAmount: bigint;
  currentTrackedAmount: bigint;
  initialAmount: bigint;
  sellPct?: number;
  exitKind?: "TP1" | "TP2" | "TP3" | "STOP" | "TIME" | "EMERGENCY";
  ladderPercents?: number[];
}): bigint {
  const { availableAmount, currentTrackedAmount, initialAmount, sellPct, exitKind, ladderPercents } = params;
  if (availableAmount <= 0n) return 0n;

  if (exitKind === "TP3") {
    return availableAmount;
  }

  if (exitKind === "TP1" || exitKind === "TP2") {
    const initial = initialAmount > 0n ? initialAmount : currentTrackedAmount;
    if (initial <= 0n) return 0n;
    const trackedCurrent = currentTrackedAmount > 0n ? currentTrackedAmount : availableAmount;
    const soldSoFar = initial > trackedCurrent ? initial - trackedCurrent : 0n;

    const percents = (ladderPercents?.length ? ladderPercents : [30, 30, 40]).slice(0, 3);
    const cumulative: number[] = [];
    let running = 0;
    for (const pct of percents) {
      running += Math.max(0, pct);
      cumulative.push(Math.min(100, running));
    }

    const step = exitKind === "TP1" ? 0 : 1;
    const targetCumPct = cumulative[step] ?? 100;
    const targetCumBps = BigInt(Math.max(0, Math.min(10_000, Math.round(targetCumPct * 100))));
    const targetSold = (initial * targetCumBps) / 10_000n;
    const needed = targetSold > soldSoFar ? targetSold - soldSoFar : 0n;
    return needed > availableAmount ? availableAmount : needed;
  }

  return applySellPct(availableAmount, sellPct);
}

function applySellPct(amount: bigint, sellPct?: number): bigint {
  if (sellPct === undefined || sellPct >= 100) return amount;
  if (sellPct <= 0) return 0n;
  const scaled = (amount * BigInt(Math.floor(sellPct * 100))) / 10_000n;
  return scaled > 0n ? scaled : amount > 0n ? 1n : 0n;
}

export function selectLiveExitSellableAmount(params: {
  resolved: ResolvedExitAmount;
  exitKind?: "TP1" | "TP2" | "TP3" | "STOP" | "TIME" | "EMERGENCY";
  emergencyTriggered: boolean;
}): bigint {
  const { resolved, exitKind, emergencyTriggered } = params;
  if (!resolved.lookupOk) return 0n;
  const isFullExit =
    emergencyTriggered ||
    exitKind === undefined ||
    exitKind === "TP3" ||
    exitKind === "STOP" ||
    exitKind === "TIME" ||
    exitKind === "EMERGENCY";
  return isFullExit ? resolved.availableAmount : resolved.bufferedAmount;
}
