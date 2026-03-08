import type { AppConfig } from "../config/schema";

export interface Sell429DeferDecision {
  defer: boolean;
  reason?: string;
  retryAtMs?: number;
}

export interface Sell429RecordResult {
  mintRetryAtMs: number;
  globalRetryAtMs?: number;
}

export interface Sell429Snapshot {
  globalCooldownUntilMs?: number;
  perMint: Array<{
    mint: string;
    streak: number;
    cooldownUntilMs: number;
  }>;
}

interface Mint429State {
  streak: number;
  cooldownUntilMs: number;
}

export interface Sell429Breaker {
  shouldDeferSell: (mint: string, nowMs: number) => Sell429DeferDecision;
  recordSell429: (mint: string, nowMs: number) => Sell429RecordResult;
  recordSellSuccess: (mint: string) => void;
  getSnapshot: (nowMs: number) => Sell429Snapshot;
}

export function createSell429Breaker(
  cfg: AppConfig["execution"]["sell429"],
  randomFn: () => number = Math.random
): Sell429Breaker {
  const mintStates = new Map<string, Mint429State>();
  const globalEvents: number[] = [];
  let globalCooldownUntilMs = 0;

  function pruneEvents(nowMs: number): void {
    const cutoff = nowMs - cfg.globalWindowMs;
    while (globalEvents.length > 0) {
      const oldest = globalEvents[0];
      if (oldest === undefined || oldest >= cutoff) break;
      globalEvents.shift();
    }
  }

  function computeMintCooldownMs(streak: number): number {
    const base = cfg.perMintBaseCooldownMs;
    const raw = base * Math.pow(cfg.backoffFactor, Math.max(0, streak - 1));
    const capped = Math.min(cfg.perMintMaxCooldownMs, raw);
    if (cfg.jitterPct <= 0) return Math.max(0, Math.floor(capped));
    const jitter = (randomFn() * 2 - 1) * cfg.jitterPct;
    const multiplier = Math.max(0.05, 1 + jitter);
    return Math.max(0, Math.floor(capped * multiplier));
  }

  return {
    shouldDeferSell: (mint, nowMs) => {
      if (nowMs < globalCooldownUntilMs) {
        return {
          defer: true,
          reason: "sell_429_global_cooldown",
          retryAtMs: globalCooldownUntilMs
        };
      }
      const state = mintStates.get(mint);
      if (state && nowMs < state.cooldownUntilMs) {
        return {
          defer: true,
          reason: "sell_429_mint_cooldown",
          retryAtMs: state.cooldownUntilMs
        };
      }
      return { defer: false };
    },
    recordSell429: (mint, nowMs) => {
      const current = mintStates.get(mint) ?? { streak: 0, cooldownUntilMs: 0 };
      const streak = current.streak + 1;
      const cooldownMs = computeMintCooldownMs(streak);
      const mintRetryAtMs = nowMs + cooldownMs;
      mintStates.set(mint, { streak, cooldownUntilMs: mintRetryAtMs });

      globalEvents.push(nowMs);
      pruneEvents(nowMs);

      let globalRetryAtMs: number | undefined;
      if (globalEvents.length >= cfg.globalTripCount) {
        globalCooldownUntilMs = Math.max(globalCooldownUntilMs, nowMs + cfg.globalCooldownMs);
        globalRetryAtMs = globalCooldownUntilMs;
      }

      return { mintRetryAtMs, globalRetryAtMs };
    },
    recordSellSuccess: (mint) => {
      mintStates.delete(mint);
    },
    getSnapshot: (nowMs) => {
      const perMint = [...mintStates.entries()]
        .map(([mint, state]) => ({
          mint,
          streak: state.streak,
          cooldownUntilMs: state.cooldownUntilMs
        }))
        .filter((row) => row.cooldownUntilMs > nowMs)
        .sort((a, b) => b.cooldownUntilMs - a.cooldownUntilMs);
      return {
        globalCooldownUntilMs: globalCooldownUntilMs > nowMs ? globalCooldownUntilMs : undefined,
        perMint
      };
    }
  };
}

export function isJupiterRateLimitError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  const rateLimited = msg.includes("429") || msg.includes("rate limit");
  const jupiterish = msg.includes("jupiter") || msg.includes("ultra");
  return rateLimited && jupiterish;
}
