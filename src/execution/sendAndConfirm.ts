import type { Logger } from "pino";
import type { SolanaRpc } from "../providers/solanaRpc";
import { sleepMs } from "../utils/time";

export async function sendAndConfirmWithRetries(params: {
  rpc: SolanaRpc;
  rawTx: Buffer;
  maxRetries: number;
  confirmTimeoutMs: number;
  landing: {
    skipPreflightOnSend: boolean;
    statusPollIntervalMs: number;
    resendIntervalMs: number;
    maxResendsPerAttempt: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
  };
  logger: Logger;
}): Promise<{ signature: string; confirmed: boolean; err?: unknown; chainErr?: unknown }> {
  const { rpc, rawTx, maxRetries, confirmTimeoutMs, landing, logger } = params;
  const retries = Math.max(0, Math.floor(maxRetries));
  let lastErr: unknown = "unknown_send_error";

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await rpc.sendAndConfirmRawTx(rawTx, {
        confirmTimeoutMs,
        skipPreflight: landing.skipPreflightOnSend,
        statusPollIntervalMs: landing.statusPollIntervalMs,
        resendIntervalMs: landing.resendIntervalMs,
        maxResends: landing.maxResendsPerAttempt
      });
      if (res.confirmed) return res;
      if (res.err === "chain_error") {
        return { signature: res.signature, confirmed: false, err: "chain_error", chainErr: res.chainErr };
      }
      throw new Error(`not_confirmed:${String(res.err ?? "unknown")}`);
    } catch (err) {
      lastErr = err;
      if (String(err).includes("chain_error")) {
        return { signature: "", confirmed: false, err: "chain_error", chainErr: String(err) };
      }
      if (attempt >= retries) break;
      const baseDelayMs = Math.max(100, Math.floor(landing.retryBaseDelayMs));
      const maxDelayMs = Math.max(baseDelayMs, Math.floor(landing.retryMaxDelayMs));
      const delayMs = Math.min(maxDelayMs, Math.max(baseDelayMs, baseDelayMs * Math.pow(2, attempt)));
      logger.warn({ attempt: attempt + 1, err: String(err), delayMs }, "send/confirm retry");
      await sleepMs(delayMs);
    }
  }

  return { signature: "", confirmed: false, err: String(lastErr) };
}
