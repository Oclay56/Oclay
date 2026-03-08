import type { AppConfig } from "../config/schema";
import type { Repos } from "../storage/repos";

export interface LossBreakerStatus {
  blocked: boolean;
  consecutiveLosses: number;
  blockedUntilMs?: number;
}

export function getLossBreakerStatus(params: {
  cfg: AppConfig;
  repos: Repos;
  mode: "paper" | "live";
  nowMs?: number;
}): LossBreakerStatus {
  const { cfg, repos, mode } = params;
  const nowMs = params.nowMs ?? Date.now();
  const dayStart = new Date(nowMs);
  dayStart.setHours(0, 0, 0, 0);

  const stats = repos.getConsecutiveLossStats({
    sinceMs: dayStart.getTime(),
    mode,
    cooldownMinutes: cfg.strategy.portfolio.consecutiveLossCooldownMinutes
  });
  if (stats.consecutiveLosses < cfg.strategy.portfolio.consecutiveLossLimit) {
    return { blocked: false, consecutiveLosses: stats.consecutiveLosses };
  }
  return {
    blocked: Boolean(stats.blockedUntilMs && stats.blockedUntilMs > nowMs),
    consecutiveLosses: stats.consecutiveLosses,
    blockedUntilMs: stats.blockedUntilMs
  };
}

