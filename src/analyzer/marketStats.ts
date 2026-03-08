import type { AppConfig } from "../config/schema";
import type { DexPairSnapshot } from "../domain/types";
import type { RiskFlag } from "../domain/flags";

export interface MarketStatsResult {
  flags: RiskFlag[];
  liquidityUsd?: number;
  volumeM5Usd?: number;
  volumeH1Usd?: number;
  volumeH24Usd?: number;
  buysM5?: number;
  sellsM5?: number;
  buysH1?: number;
  sellsH1?: number;
  marketAgeMinutes?: number;
  priceUsd?: number;
  pairCreatedAtMs?: number;
  dexId?: string;
  pairAddress?: string;
  url?: string;
}

export function analyzeMarketStats(cfg: AppConfig, bestPair: DexPairSnapshot | null, nowMs: number): MarketStatsResult {
  const flags: RiskFlag[] = [];
  if (!bestPair) {
    flags.push("LOW_LIQUIDITY");
    flags.push("LOW_VOLUME");
    return { flags };
  }

  const liquidityUsd = bestPair.liquidityUsd;
  const volumeM5Usd = bestPair.volume?.m5;
  const volumeH1Usd = bestPair.volume?.h1;
  const volumeH24Usd = bestPair.volume?.h24;
  const buysM5 = bestPair.txns?.m5?.buys;
  const sellsM5 = bestPair.txns?.m5?.sells;
  const buysH1 = bestPair.txns?.h1?.buys;
  const sellsH1 = bestPair.txns?.h1?.sells;
  const pairCreatedAtMs = bestPair.pairCreatedAt;
  const marketAgeMinutes =
    pairCreatedAtMs && pairCreatedAtMs > 0 ? Math.max(0, (nowMs - pairCreatedAtMs) / 60_000) : undefined;

  if ((liquidityUsd ?? 0) < cfg.analysis.minLiquidityUsd) flags.push("LOW_LIQUIDITY");
  if ((volumeH24Usd ?? 0) < cfg.analysis.minVolumeH24Usd) flags.push("LOW_VOLUME");

  if (marketAgeMinutes !== undefined) {
    if (marketAgeMinutes < cfg.analysis.minMarketAgeMinutes) flags.push("TOO_NEW");
    if (cfg.analysis.maxMarketAgeMinutes > 0 && marketAgeMinutes > cfg.analysis.maxMarketAgeMinutes) {
      // Not necessarily a risk, but we keep it as a soft filter in strategy via opportunity score decay.
    }
  }

  const priceUsd = bestPair.priceUsd ? Number(bestPair.priceUsd) : undefined;
  return {
    flags,
    liquidityUsd,
    volumeM5Usd,
    volumeH1Usd,
    volumeH24Usd,
    buysM5,
    sellsM5,
    buysH1,
    sellsH1,
    marketAgeMinutes,
    priceUsd,
    pairCreatedAtMs,
    dexId: bestPair.dexId,
    pairAddress: bestPair.pairAddress,
    url: bestPair.url
  };
}
