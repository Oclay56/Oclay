import type { AppConfig } from "../config/schema";
import type { RiskFlag } from "../domain/flags";

export interface RugSignalsResult {
  flags: RiskFlag[];
  supplyDeltaPct?: number;
  liquidityDeltaPct?: number;
}

export function analyzeRugSignals(params: {
  cfg: AppConfig;
  prevSupply?: bigint;
  currentSupply?: bigint;
  prevLiquidityUsd?: number | null;
  currentLiquidityUsd?: number | null;
}): RugSignalsResult {
  const flags: RiskFlag[] = [];

  let supplyDeltaPct: number | undefined;
  if (params.prevSupply !== undefined && params.currentSupply !== undefined && params.prevSupply > 0n) {
    const prev = params.prevSupply;
    const cur = params.currentSupply;
    if (cur > prev) {
      supplyDeltaPct = Number(((cur - prev) * 10_000n) / prev) / 100;
      // Heuristic: any meaningful supply increase is suspicious for memecoins.
      if (cur > (prev * 1005n) / 1000n) flags.push("SUPPLY_INCREASED"); // >0.5%
    }
  }

  let liquidityDeltaPct: number | undefined;
  if (
    params.prevLiquidityUsd !== undefined &&
    params.prevLiquidityUsd !== null &&
    params.currentLiquidityUsd !== undefined &&
    params.currentLiquidityUsd !== null &&
    params.prevLiquidityUsd > 0
  ) {
    const prev = params.prevLiquidityUsd;
    const cur = params.currentLiquidityUsd;
    liquidityDeltaPct = ((cur - prev) / prev) * 100;
    const drainPct = ((prev - cur) / prev) * 100;
    if (drainPct >= params.cfg.guardian.liquidityDrainPct) flags.push("LIQUIDITY_DRAIN");
  }

  return { flags, supplyDeltaPct, liquidityDeltaPct };
}

