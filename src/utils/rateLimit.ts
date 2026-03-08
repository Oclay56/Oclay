import PQueue from "p-queue";

export interface RateLimitConfig {
  concurrency: number;
  intervalCap: number;
  intervalMs: number;
}

export function createRateLimitedQueue(cfg: RateLimitConfig): PQueue {
  return new PQueue({
    concurrency: cfg.concurrency,
    intervalCap: cfg.intervalCap,
    interval: cfg.intervalMs,
    carryoverConcurrencyCount: true
  });
}

