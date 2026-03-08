import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { RiskFlag } from "../domain/flags";
import type { DexPairSnapshot, TokenRiskReport } from "../domain/types";
import type { SolanaRpc } from "../providers/solanaRpc";
import type { JupiterUltraClient } from "../providers/jupiterUltra";
import { analyzeMarketStats } from "./marketStats";
import { analyzeMintSafety } from "./mintSafety";
import { analyzeRouteFeasibility } from "./routeFeasibility";
import { computeOpportunityScore, computeRiskScore } from "../strategy/score";

export interface StageAResult {
  report: TokenRiskReport;
  hardReject: boolean;
}

export async function analyzeStageA(params: {
  cfg: AppConfig;
  mint: string;
  bestPair: DexPairSnapshot | null;
  rpc: SolanaRpc;
  jup: JupiterUltraClient;
  logger: Logger;
  createdAtMs?: number;
  activeFlags?: RiskFlag[];
}): Promise<StageAResult> {
  const { cfg, mint, bestPair, rpc, jup, logger } = params;
  const createdAtMs = params.createdAtMs ?? Date.now();

  const market = analyzeMarketStats(cfg, bestPair, createdAtMs);
  const mintSafety = await (async () => {
    try {
      return await analyzeMintSafety(cfg, rpc, mint);
    } catch (err) {
      logger.debug({ mint, err: String(err) }, "stageA mint safety failed");
      return { flags: [] as RiskFlag[], tokenProgram: "unknown" as const };
    }
  })();
  const route = await analyzeRouteFeasibility(cfg, jup, mint);
  const quickHolders = await analyzeQuickHolderConcentration(rpc, mint).catch(() => ({
    flags: ["HOLDERS_UNKNOWN" as RiskFlag],
    top1HolderPct: undefined,
    top10HolderPct: undefined
  }));

  const flags = uniqFlags([
    ...(params.activeFlags ?? []),
    ...market.flags,
    ...mintSafety.flags,
    ...route.flags,
    ...quickHolders.flags
  ]);

  const riskScore = computeRiskScore(cfg, flags);
  const opportunityScore = computeOpportunityScore(cfg, bestPair);
  const tradeScore = opportunityScore - cfg.strategy.riskWeight * riskScore;
  const reasons = flags.map(flagToReason);

  const hardReject = hasStageAHardReject({
    cfg,
    flags,
    canExitRoute: route.canExitRoute
  });

  const report: TokenRiskReport = {
    mint,
    createdAtMs,
    flags,
    canExitRoute: route.canExitRoute,
    impliedRoundTripLossBps: route.impliedRoundTripLossBps,
    top1HolderPct: quickHolders.top1HolderPct,
    top10HolderPct: quickHolders.top10HolderPct,
    liquidityUsd: market.liquidityUsd,
    volumeH24Usd: market.volumeH24Usd,
    marketAgeMinutes: market.marketAgeMinutes,
    priceImpactPct: route.priceImpactPct,
    riskScore,
    opportunityScore,
    tradeScore,
    reasons,
    metrics: {
      stage: "A",
      market,
      mintSafety: {
        tokenProgram: mintSafety.tokenProgram,
        mintAuthority: mintSafety.mintAuthority,
        freezeAuthority: mintSafety.freezeAuthority,
        decimals: mintSafety.decimals,
        supplyAmount: mintSafety.supply?.toString()
      },
      route: {
        canExitRoute: route.canExitRoute,
        impliedRoundTripLossBps: route.impliedRoundTripLossBps,
        buyOutAmount: route.buyOutAmount?.toString(),
        sellOutAmount: route.sellOutAmount?.toString(),
        priceImpactPct: route.priceImpactPct
      },
      quickHolders
    }
  };

  return { report, hardReject };
}

async function analyzeQuickHolderConcentration(
  rpc: SolanaRpc,
  mint: string
): Promise<{ flags: RiskFlag[]; top1HolderPct?: number; top10HolderPct?: number }> {
  const largest = await rpc.getTokenLargestAccounts(mint);
  const values = largest?.value ?? [];
  if (!values.length) return { flags: ["HOLDERS_UNKNOWN"], top1HolderPct: undefined, top10HolderPct: undefined };

  const total = values.reduce((acc: bigint, v: any) => acc + BigInt(v.amount ?? "0"), 0n);
  if (total <= 0n) return { flags: ["HOLDERS_UNKNOWN"], top1HolderPct: undefined, top10HolderPct: undefined };

  const sorted = [...values]
    .map((v: any) => BigInt(v.amount ?? "0"))
    .sort((a: bigint, b: bigint) => (a > b ? -1 : a < b ? 1 : 0));
  const top1 = sorted[0] ?? 0n;
  const top10 = sorted.slice(0, 10).reduce((acc, x) => acc + x, 0n);
  const top1HolderPct = Number(top1) / Number(total) * 100;
  const top10HolderPct = Number(top10) / Number(total) * 100;
  return {
    flags: [],
    top1HolderPct,
    top10HolderPct
  };
}

function hasStageAHardReject(params: { cfg: AppConfig; flags: RiskFlag[]; canExitRoute: boolean }): boolean {
  const { cfg, flags, canExitRoute } = params;
  if (!canExitRoute) return true;
  if (flags.includes("LOW_LIQUIDITY")) return true;
  if (cfg.analysis.rejectIfMintAuthority && flags.includes("HAS_MINT_AUTH")) return true;
  if (cfg.analysis.rejectIfFreezeAuthority && flags.includes("HAS_FREEZE_AUTH")) return true;
  if (cfg.analysis.rejectIfToken2022TransferHook && flags.includes("TOKEN2022_TRANSFER_HOOK")) return true;
  if (cfg.analysis.rejectIfToken2022NonTransferable && flags.includes("NON_TRANSFERABLE")) return true;
  if (cfg.analysis.rejectIfToken2022DefaultFrozen && flags.includes("DEFAULT_FROZEN")) return true;
  return false;
}

function uniqFlags(flags: RiskFlag[]): RiskFlag[] {
  return [...new Set(flags)];
}

function flagToReason(f: RiskFlag): string {
  return `stageA:${f}`;
}
