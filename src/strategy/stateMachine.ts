import type { AppConfig } from "../config/schema";
import type { Position } from "../domain/types";

export interface ExitSignal {
  shouldExit: boolean;
  reason?: string;
  updatedMaxSeenPriceUsd?: number;
  sellPct?: number;
  nextTpStep?: number;
  exitKind?: "TP1" | "TP2" | "TP3" | "STOP" | "TIME" | "EMERGENCY";
}

export function computeExitSignal(cfg: AppConfig, position: Position, currentPriceUsd: number | null, nowMs: number): ExitSignal {
  const exits = cfg.strategy.exits;

  // Max hold time
  const heldMinutes = (nowMs - position.openedAtMs) / 60_000;
  const maxHoldMinutes = position.sniperMode ? cfg.strategy.sniper.maxHoldMinutes : exits.maxHoldMinutes;
  if (maxHoldMinutes > 0 && heldMinutes >= maxHoldMinutes) {
    return { shouldExit: true, reason: `maxHoldMinutes exceeded (${heldMinutes.toFixed(1)}m)`, sellPct: 100, exitKind: "TIME" };
  }

  if (!currentPriceUsd || !position.entryPriceUsd) return { shouldExit: false };

  const entry = position.entryPriceUsd;
  const maxSeen = Math.max(position.maxSeenPriceUsd ?? entry, currentPriceUsd);
  const updatedMaxSeenPriceUsd = maxSeen !== position.maxSeenPriceUsd ? maxSeen : undefined;

  const stopLossPx = entry * (1 - exits.stopLossBps / 10_000);
  if (currentPriceUsd <= stopLossPx) {
    return { shouldExit: true, reason: `stopLoss hit (${currentPriceUsd.toFixed(8)} <= ${stopLossPx.toFixed(8)})`, updatedMaxSeenPriceUsd };
  }

  const ladderPercents = exits.tpLadderPercents ?? [30, 30, 40];
  const ladderTriggers = exits.tpLadderTriggerBps ?? [1200, 2500, 4000];
  const tpStep = Math.max(0, position.tpStep ?? 0);
  if (tpStep < 3) {
    const triggerBps = ladderTriggers[tpStep];
    if (triggerBps !== undefined) {
      const targetPx = entry * (1 + triggerBps / 10_000);
      if (currentPriceUsd >= targetPx) {
        const pct = ladderPercents[tpStep] ?? 100;
        return {
          shouldExit: true,
          reason: `tp${tpStep + 1} hit (${currentPriceUsd.toFixed(8)} >= ${targetPx.toFixed(8)})`,
          updatedMaxSeenPriceUsd,
          sellPct: pct,
          nextTpStep: Math.min(3, tpStep + 1),
          exitKind: (["TP1", "TP2", "TP3"] as const)[tpStep]
        };
      }
    }
  }

  const trailingBps = (position.tpStep ?? 0) >= 1 ? exits.trailingAfterTp1Bps : exits.trailingStopBps;
  const trailingStopPx = maxSeen * (1 - trailingBps / 10_000);
  if (maxSeen > entry && currentPriceUsd <= trailingStopPx) {
    return {
      shouldExit: true,
      reason: `trailingStop hit (${currentPriceUsd.toFixed(8)} <= ${trailingStopPx.toFixed(8)})`,
      updatedMaxSeenPriceUsd,
      sellPct: 100,
      exitKind: "STOP"
    };
  }

  return { shouldExit: false, updatedMaxSeenPriceUsd };
}
