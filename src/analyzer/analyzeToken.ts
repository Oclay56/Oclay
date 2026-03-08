import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { DexPairSnapshot, TokenRiskReport } from "../domain/types";
import type { Repos } from "../storage/repos";
import type { SolanaRpc } from "../providers/solanaRpc";
import type { JupiterUltraClient } from "../providers/jupiterUltra";
import { analyzeStageA } from "./analyzeStageA";
import { analyzeStageB } from "./analyzeStageB";

export async function analyzeToken(params: {
  cfg: AppConfig;
  mint: string;
  bestPair: DexPairSnapshot | null;
  rpc: SolanaRpc;
  jup: JupiterUltraClient;
  repos: Repos;
  logger: Logger;
  mode?: "paper" | "live";
  stage?: "A" | "B";
}): Promise<TokenRiskReport> {
  const { cfg, mint, bestPair, rpc, jup, repos, logger } = params;
  const mode = params.mode ?? "paper";
  const nowMs = Date.now();
  const activeBlock = repos.getBlock(mint, nowMs);
  const activeFlags = activeBlock?.reason?.startsWith("probe_failed:") ? (["PROBE_FAILED"] as any) : [];

  const stageA = await analyzeStageA({
    cfg,
    mint,
    bestPair,
    rpc,
    jup,
    logger,
    createdAtMs: nowMs,
    activeFlags
  });
  let report = stageA.report;
  if ((params.stage ?? "B") === "B" && !(cfg.analysis.skipDeepChecksOnHardReject && stageA.hardReject)) {
    report = await analyzeStageB({
      cfg,
      mint,
      bestPair,
      stageA: report,
      repos,
      rpc,
      logger,
      createdAtMs: Date.now()
    });
  } else {
    report.reasons.push("Deep checks skipped: stageA hard reject or stage forced to A.");
  }

  if (mode === "paper" && cfg.probe.requiredInLive) {
    report.reasons.push("Probe is required in live mode; paper mode cannot chain-confirm probe execution.");
  }

  logger.info(
    { mint, flags: report.flags, riskScore: report.riskScore, opportunityScore: report.opportunityScore, tradeScore: report.tradeScore, liqUsd: report.liquidityUsd, volH24: report.volumeH24Usd, stage: (report.metrics as any)?.stage ?? "A" },
    "token analyzed"
  );
  return report;
}

