import type { Logger } from "pino";
import type { DexPairSnapshot } from "../domain/types";

export interface DexScreenerTokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
}

export class DexScreenerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly logger: Logger
  ) {}

  async getLatestTokenProfiles(signal?: AbortSignal): Promise<DexScreenerTokenProfile[]> {
    const base = this.baseUrl.replace(/\/$/, "");
    const url = `${base}/token-profiles/latest/v1`;
    const resp = await fetchWithTimeout(url, {
      method: "GET",
      headers: { "accept": "application/json" }
    }, 12_000, signal);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`DexScreener latest profiles failed: ${resp.status} ${text}`);
    }
    const json = (await resp.json()) as any;
    // DexScreener currently returns an array at the root, but older clients documented `{ value: [...] }`.
    const value = Array.isArray(json) ? json : Array.isArray(json?.value) ? json.value : [];
    return (value as any[])
      .map((x: any) => ({
        url: String(x.url ?? ""),
        chainId: String(x.chainId ?? ""),
        tokenAddress: String(x.tokenAddress ?? "")
      }))
      .filter((x: DexScreenerTokenProfile) => x.chainId && x.tokenAddress);
  }

  async getTokenPairs(tokenAddress: string, signal?: AbortSignal): Promise<DexPairSnapshot[]> {
    const base = this.baseUrl.replace(/\/$/, "");
    const url = `${base}/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`;
    const resp = await fetchWithTimeout(url, {
      method: "GET",
      headers: { "accept": "application/json" }
    }, 12_000, signal);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`DexScreener token pairs failed: ${resp.status} ${text}`);
    }
    const json = (await resp.json()) as any;
    const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
    return pairs.map(toDexPairSnapshot);
  }

  selectBestPair(params: {
    pairs: DexPairSnapshot[];
    minLiquidityUsd: number;
    dexAllowlist: string[];
    preferMints: string[];
  }): DexPairSnapshot | null {
    const allow = new Set(params.dexAllowlist.map((s) => s.toLowerCase()));
    const prefer = new Set(params.preferMints);
    const candidates = params.pairs
      .filter((p) => p.chainId === "solana")
      .filter((p) => (p.liquidityUsd ?? 0) >= params.minLiquidityUsd);

    if (candidates.length === 0) return null;

    const sorted = [...candidates].sort((a, b) => {
      const liqA = a.liquidityUsd ?? 0;
      const liqB = b.liquidityUsd ?? 0;
      if (liqA !== liqB) return liqB - liqA;

      const preferA = prefer.has(a.baseToken.address) || prefer.has(a.quoteToken.address) ? 1 : 0;
      const preferB = prefer.has(b.baseToken.address) || prefer.has(b.quoteToken.address) ? 1 : 0;
      if (preferA !== preferB) return preferB - preferA;

      const allowA = allow.size > 0 && allow.has(a.dexId.toLowerCase()) ? 1 : 0;
      const allowB = allow.size > 0 && allow.has(b.dexId.toLowerCase()) ? 1 : 0;
      if (allowA !== allowB) return allowB - allowA;

      // Stable tie-breaker
      return a.pairAddress.localeCompare(b.pairAddress);
    });

    const best = sorted[0] ?? null;
    if (!best) return null;
    this.logger.debug(
      { mint: params.preferMints[0], pair: best.pairAddress, dex: best.dexId, liqUsd: best.liquidityUsd },
      "selected best pair"
    );
    return best;
  }
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (init.signal) signals.push(init.signal);
  if (signal) signals.push(signal);
  const merged = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
  return await fetch(input, { ...init, signal: merged });
}

function toDexPairSnapshot(pair: any): DexPairSnapshot {
  const liquidityUsd = pair?.liquidity?.usd;
  return {
    chainId: String(pair?.chainId ?? ""),
    dexId: String(pair?.dexId ?? ""),
    url: String(pair?.url ?? ""),
    pairAddress: String(pair?.pairAddress ?? ""),
    baseToken: {
      address: String(pair?.baseToken?.address ?? ""),
      symbol: String(pair?.baseToken?.symbol ?? ""),
      name: String(pair?.baseToken?.name ?? "")
    },
    quoteToken: {
      address: String(pair?.quoteToken?.address ?? ""),
      symbol: String(pair?.quoteToken?.symbol ?? ""),
      name: String(pair?.quoteToken?.name ?? "")
    },
    priceNative: pair?.priceNative ? String(pair.priceNative) : undefined,
    priceUsd: pair?.priceUsd ? String(pair.priceUsd) : undefined,
    liquidityUsd: typeof liquidityUsd === "number" ? liquidityUsd : undefined,
    volume: pair?.volume
      ? {
          m5: toNum(pair.volume.m5),
          h1: toNum(pair.volume.h1),
          h6: toNum(pair.volume.h6),
          h24: toNum(pair.volume.h24)
        }
      : undefined,
    txns: pair?.txns
      ? {
          m5: pair.txns.m5 ? { buys: toInt(pair.txns.m5.buys), sells: toInt(pair.txns.m5.sells) } : undefined,
          h1: pair.txns.h1 ? { buys: toInt(pair.txns.h1.buys), sells: toInt(pair.txns.h1.sells) } : undefined,
          h6: pair.txns.h6 ? { buys: toInt(pair.txns.h6.buys), sells: toInt(pair.txns.h6.sells) } : undefined,
          h24: pair.txns.h24 ? { buys: toInt(pair.txns.h24.buys), sells: toInt(pair.txns.h24.sells) } : undefined
        }
      : undefined,
    priceChange: pair?.priceChange
      ? {
          m5: toNum(pair.priceChange.m5),
          h1: toNum(pair.priceChange.h1),
          h6: toNum(pair.priceChange.h6),
          h24: toNum(pair.priceChange.h24)
        }
      : undefined,
    pairCreatedAt: typeof pair?.pairCreatedAt === "number" ? pair.pairCreatedAt : undefined
  };
}

function toNum(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toInt(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
