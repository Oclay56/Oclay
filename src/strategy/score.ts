import type { AppConfig } from "../config/schema";
import type { RiskFlag } from "../domain/flags";
import type { DexPairSnapshot } from "../domain/types";
import { clamp } from "../utils/time";

export function computeRiskScore(cfg: AppConfig, flags: RiskFlag[]): number {
  let score = 0;
  for (const f of flags) score += cfg.strategy.weights[f] ?? 0;
  return clamp(score, 0, 100);
}

export function computeOpportunityScore(cfg: AppConfig, bestPair: DexPairSnapshot | null): number {
  if (!bestPair) return 0;

  let s = 0;
  const liq = bestPair.liquidityUsd ?? 0;
  const v24 = bestPair.volume?.h24 ?? 0;

  if (liq >= cfg.analysis.minLiquidityUsd) s += 10;
  if (liq >= cfg.analysis.minLiquidityUsd * 3) s += 10;

  if (v24 >= cfg.analysis.minVolumeH24Usd) s += 10;
  if (v24 >= cfg.analysis.minVolumeH24Usd * 5) s += 10;

  // Volume acceleration (m5 compared to h1 average)
  const v5 = bestPair.volume?.m5;
  const v1h = bestPair.volume?.h1;
  if (v5 !== undefined && v1h !== undefined && v1h > 0) {
    const projectedHour = v5 * 12;
    const ratio = projectedHour / v1h;
    if (ratio >= 1.5) s += 10;
    if (ratio >= 3.0) s += 10;
  }

  // Buy/sell imbalance
  const m5 = bestPair.txns?.m5;
  const h1 = bestPair.txns?.h1;
  const ratioM5 = m5 ? (m5.buys + 1) / (m5.sells + 1) : undefined;
  const ratioH1 = h1 ? (h1.buys + 1) / (h1.sells + 1) : undefined;
  const ratio = ratioM5 ?? ratioH1;
  if (ratio !== undefined) {
    if (ratio >= 1.3) s += 8;
    if (ratio >= 1.8) s += 12;
  }

  // Momentum
  const ch1 = bestPair.priceChange?.h1;
  const cm5 = bestPair.priceChange?.m5;
  const mom = cm5 ?? ch1;
  if (mom !== undefined) {
    if (mom >= 2) s += 5;
    if (mom >= 8) s += 8;
    if (mom >= 20) s += 10;
    if (mom <= -10) s -= 8;
  }

  return clamp(s, 0, 100);
}

