import type { AppConfig } from "../config/schema";
import type { Position } from "../domain/types";

export interface SniperScaleDecision {
  shouldScale: boolean;
  reason?: string;
  amountPct?: number;
}

export function decideSniperScale(params: {
  cfg: AppConfig;
  position: Position;
  nowMs: number;
  routeHealthy: boolean;
  liquidityDegradePct?: number;
  hasCriticalFlags: boolean;
  stageBStatus?: "pending" | "clean" | "critical" | "failed" | "timeout";
}): SniperScaleDecision {
  const { cfg, position, nowMs, routeHealthy, liquidityDegradePct, hasCriticalFlags, stageBStatus } = params;
  if (!cfg.strategy.sniper.enabled || !position.sniperMode) return { shouldScale: false, reason: "sniper_disabled" };
  if (position.stage !== "TEST") return { shouldScale: false, reason: "not_in_test_stage" };
  const heldMs = nowMs - position.openedAtMs;
  if (heldMs < cfg.strategy.sniper.scaleDelayMs) return { shouldScale: false, reason: "scale_delay_not_elapsed" };
  if (cfg.strategy.sniper.requireStageBForScale && stageBStatus !== "clean") {
    return { shouldScale: false, reason: `stageb_gate:${stageBStatus ?? "pending"}` };
  }
  if (cfg.strategy.sniper.requireStableSellRoute && !routeHealthy) return { shouldScale: false, reason: "sell_route_unstable" };
  if (hasCriticalFlags) return { shouldScale: false, reason: "critical_stageb_flags" };
  if (
    liquidityDegradePct !== undefined &&
    liquidityDegradePct > cfg.strategy.sniper.maxLiquidityDegradePctBeforeScale
  ) {
    return { shouldScale: false, reason: "liquidity_degraded" };
  }
  return { shouldScale: true, amountPct: cfg.strategy.sniper.scaleEntryPct, reason: "sniper_scale_ok" };
}
