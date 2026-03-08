import type { Logger } from "pino";

export interface UltraOrderRequest {
  inputMint: string;
  outputMint: string;
  amount: string; // base units
  taker?: string;
  slippageBps?: number;
  signal?: AbortSignal;
}

export interface UltraOrderResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string | number;
  routePlan?: unknown[];
  transaction?: string | null;
  requestId?: string;
  feeBps?: number;
  otherAmountThreshold?: string;
  raw: unknown;
}

export class JupiterUltraClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly logger: Logger
  ) {}

  async getOrder(req: UltraOrderRequest): Promise<UltraOrderResponse> {
    const base = this.baseUrl.replace(/\/$/, "");
    const url = new URL(`${base}/order`);
    url.searchParams.set("inputMint", req.inputMint);
    url.searchParams.set("outputMint", req.outputMint);
    url.searchParams.set("amount", req.amount);
    if (req.taker) url.searchParams.set("taker", req.taker);
    if (req.slippageBps !== undefined) url.searchParams.set("slippageBps", String(req.slippageBps));

    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey && this.baseUrl.includes("api.jup.ag")) headers["x-api-key"] = this.apiKey;

    const resp = await fetchWithTimeout(url.toString(), { method: "GET", headers }, 15_000, req.signal);
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`Jupiter Ultra order failed: ${resp.status} ${text}`);
    }

    const json = JSON.parse(text) as any;
    if (req.taker && (json?.errorCode || json?.error || json?.errorMessage)) {
      const msg = String(json?.errorMessage ?? json?.error ?? "unknown_error");
      throw new Error(`Jupiter Ultra order error: ${msg}`);
    }
    const outAmount = String(json?.outAmount ?? "");
    const inAmount = String(json?.inAmount ?? "");
    const transaction = json?.transaction === undefined ? undefined : (json.transaction as any);

    if (!outAmount || !inAmount) {
      this.logger.debug({ json }, "unexpected Jupiter Ultra response");
      throw new Error("Jupiter Ultra order response missing inAmount/outAmount");
    }

    return {
      inputMint: String(json?.inputMint ?? req.inputMint),
      outputMint: String(json?.outputMint ?? req.outputMint),
      inAmount,
      outAmount,
      priceImpactPct: json?.priceImpactPct,
      routePlan: json?.routePlan,
      transaction,
      requestId: json?.requestId ? String(json.requestId) : undefined,
      feeBps: typeof json?.feeBps === "number" ? json.feeBps : undefined,
      otherAmountThreshold: json?.otherAmountThreshold ? String(json.otherAmountThreshold) : undefined,
      raw: json
    };
  }
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (init.signal) signals.push(init.signal);
  if (signal) signals.push(signal);
  const merged = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
  return await fetch(input, { ...init, signal: merged });
}

export function parsePriceImpactPct(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
