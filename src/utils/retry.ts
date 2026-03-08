import { sleepMs } from "./time";

export interface RetryOptions {
  retries: number;
  minDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: number; // 0..1
  onRetry?: (info: { attempt: number; err: unknown; delayMs: number }) => void;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let attempt = 0;
  // attempt 0 is the first try; retries is additional tries
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.retries) throw err;
      const exp = opts.minDelayMs * Math.pow(opts.factor, attempt);
      const capped = Math.min(opts.maxDelayMs, exp);
      const jittered = capped * (1 - opts.jitter + Math.random() * opts.jitter);
      const delayMs = Math.max(0, Math.floor(jittered));
      opts.onRetry?.({ attempt: attempt + 1, err, delayMs });
      await sleepMs(delayMs);
      attempt++;
    }
  }
}

