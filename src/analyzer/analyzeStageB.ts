import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { RiskFlag } from "../domain/flags";
import type { DexPairSnapshot, TokenRiskReport } from "../domain/types";
import type { Repos } from "../storage/repos";
import type { SolanaRpc } from "../providers/solanaRpc";
import { analyzeHolders } from "./holders";
import { analyzeDevCluster } from "./devCluster";
import { analyzeDevBehavior } from "./devBehavior";
import { analyzeRugSignals } from "./rugSignals";
import { computeOpportunityScore, computeRiskScore } from "../strategy/score";

export type StageBStatus = "pending" | "clean" | "critical" | "failed";

export async function analyzeStageB(params: {
  cfg: AppConfig;
  mint: string;
  bestPair: DexPairSnapshot | null;
  stageA: TokenRiskReport;
  repos: Repos;
  rpc: SolanaRpc;
  logger: Logger;
  createdAtMs?: number;
}): Promise<TokenRiskReport> {
  const { cfg, mint, bestPair, stageA, repos, rpc, logger } = params;
  const createdAtMs = params.createdAtMs ?? Date.now();
  const prevReport = repos.getLatestRiskReport(mint);
  const prevSnapshot = repos.getLatestSnapshot(mint);

  const mintSafety = (stageA.metrics as any)?.mintSafety ?? {};
  const holders = await analyzeHolders(cfg, rpc, mint);
  const devCluster = await (async () => {
    try {
      return await analyzeDevCluster({
        rpc,
        mint,
        mintAuthority: mintSafety.mintAuthority ?? undefined,
        freezeAuthority: mintSafety.freezeAuthority ?? undefined
      });
    } catch (err) {
      logger.debug({ mint, err: String(err) }, "stageB dev cluster failed");
      return { devWallets: [], creatorWallet: undefined };
    }
  })();
  const devBehavior = await analyzeDevBehavior({
    rpc,
    mint,
    creatorWallet: devCluster.creatorWallet,
    supplyAmount: mintSafety.supplyAmount ? BigInt(String(mintSafety.supplyAmount)) : undefined
  });
  const rug = analyzeRugSignals({
    cfg,
    prevSupply: prevReport?.metrics?.mintSafety?.supplyAmount
      ? BigInt(String(prevReport.metrics.mintSafety.supplyAmount))
      : undefined,
    currentSupply: mintSafety.supplyAmount ? BigInt(String(mintSafety.supplyAmount)) : undefined,
    prevLiquidityUsd: prevSnapshot?.liquidityUsd ?? null,
    currentLiquidityUsd: stageA.liquidityUsd ?? null
  });

  const flags = uniqFlags([
    ...(stageA.flags as RiskFlag[]),
    ...holders.flags,
    ...devBehavior.flags,
    ...rug.flags
  ]);
  const riskScore = computeRiskScore(cfg, flags);
  const opportunityScore = computeOpportunityScore(cfg, bestPair);
  const tradeScore = opportunityScore - cfg.strategy.riskWeight * riskScore;
  const reasons = flags.map((f) => `stageB:${f}`);

  return {
    ...stageA,
    createdAtMs,
    flags,
    riskScore,
    opportunityScore,
    tradeScore,
    reasons,
    top1HolderPct: holders.top1HolderPct ?? stageA.top1HolderPct,
    top10HolderPct: holders.top10HolderPct ?? stageA.top10HolderPct,
    metrics: {
      ...(stageA.metrics ?? {}),
      stage: "B",
      holders,
      devCluster,
      devBehavior: {
        ...devBehavior,
        creatorHoldingAmount: (devBehavior as any).creatorHoldingAmount?.toString?.(),
        recentOutflowAmount: (devBehavior as any).recentOutflowAmount?.toString?.()
      },
      rug
    }
  };
}

function uniqFlags(flags: RiskFlag[]): RiskFlag[] {
  return [...new Set(flags)];
}

export function classifyStageBStatus(report: TokenRiskReport | null | undefined): {
  status: StageBStatus;
  reason: string;
} {
  if (!report) return { status: "pending", reason: "stageb_pending" };
  const critical = new Set<RiskFlag>([
    "EXIT_ROUTE_GONE",
    "LIQUIDITY_DRAIN",
    "SUPPLY_INCREASED",
    "DEV_DUMPING",
    "NO_EXIT_ROUTE",
    "PROBE_FAILED"
  ]);
  const criticalFlag = report.flags.find((f) => critical.has(f));
  if (criticalFlag) return { status: "critical", reason: `critical:${criticalFlag}` };
  return { status: "clean", reason: "stageb_clean" };
}
