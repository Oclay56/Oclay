import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { DexPairSnapshot } from "../domain/types";

const DEFAULT_RAYDIUM_API_BASE_URL = "https://api-v3.raydium.io";
const RAYDIUM_CPMM_PROGRAM_ID = "CPMMoo8L3F4NbTegBCKVNfS2bY2Gb5j2qWQY3X2Y9E7";

export interface RaydiumPoolResolution {
  eligible: boolean;
  reason?: string;
  poolId?: string;
  poolKind?: "cpmm";
  programId?: string;
  raw?: unknown;
}

export interface RaydiumCpmmSwapKeys {
  poolId: string;
  programId: string;
  authority: string;
  ammConfig: string;
  observationState: string;
  mintA: string;
  mintB: string;
  vaultA: string;
  vaultB: string;
  inputMint: string;
  outputMint: string;
  inputVault: string;
  outputVault: string;
  inputTokenProgram?: string;
  outputTokenProgram?: string;
  feeNumerator?: bigint;
  feeDenominator?: bigint;
}

export class RaydiumProvider {
  private readonly apiBaseUrl: string;

  constructor(
    private readonly cfg: AppConfig,
    private readonly logger: Logger,
    apiBaseUrl?: string
  ) {
    this.apiBaseUrl = (apiBaseUrl || DEFAULT_RAYDIUM_API_BASE_URL).replace(/\/$/, "");
  }

  canAttemptDirectEntry(bestPair: DexPairSnapshot | null): boolean {
    if (!this.cfg.execution.router.raydium.enabled) return false;
    if (!this.cfg.execution.router.raydium.directEntryEnabled) return false;
    if (!bestPair) return false;
    return bestPair.dexId.toLowerCase().includes("raydium");
  }

  getSupportedPoolKinds(): Array<"cpmm" | "clmm"> {
    return this.cfg.execution.router.raydium.supportedPoolKinds;
  }

  getApiBaseUrl(): string {
    return this.apiBaseUrl;
  }

  async resolveDirectPool(bestPair: DexPairSnapshot | null): Promise<RaydiumPoolResolution> {
    if (!this.canAttemptDirectEntry(bestPair)) {
      return { eligible: false, reason: "raydium_direct_disabled_or_not_eligible" };
    }
    const poolId = bestPair?.pairAddress ? String(bestPair.pairAddress) : "";
    if (!poolId) return { eligible: false, reason: "missing_pair_address" };

    try {
      const url = `${this.apiBaseUrl}/pools/info/ids?ids=${encodeURIComponent(poolId)}`;
      const resp = await fetchWithTimeout(url, { method: "GET", headers: { accept: "application/json" } }, 12_000);
      const text = await resp.text();
      if (!resp.ok) return { eligible: false, reason: `pool_info_http_${resp.status}` };
      const json = JSON.parse(text) as any;
      const rows = Array.isArray(json?.data) ? json.data : [];
      const row = rows.find((r: any) => String(r?.id ?? "") === poolId) ?? rows[0];
      if (!row) return { eligible: false, reason: "pool_not_found", raw: json };

      const rawType = String(row?.type ?? "");
      const resolvedKind = inferPoolKind(rawType);
      if (resolvedKind !== "cpmm") {
        return { eligible: false, reason: `unsupported_pool_kind:${rawType || "unknown"}`, raw: row };
      }
      if (!this.cfg.execution.router.raydium.poolKindPriority.includes("cpmm")) {
        return { eligible: false, reason: "cpmm_not_prioritized", raw: row };
      }
      return {
        eligible: true,
        poolId,
        poolKind: "cpmm",
        programId: row?.programId ? String(row.programId) : RAYDIUM_CPMM_PROGRAM_ID,
        raw: row
      };
    } catch (err) {
      return { eligible: false, reason: `pool_info_error:${String(err)}` };
    }
  }

  resolveCpmmSwapKeys(params: {
    pool: RaydiumPoolResolution;
    inputMint: string;
    outputMint: string;
  }): { ok: true; keys: RaydiumCpmmSwapKeys } | { ok: false; reason: string; raw?: unknown } {
    const { pool, inputMint, outputMint } = params;
    if (!pool.eligible || !pool.poolId || pool.poolKind !== "cpmm") {
      return { ok: false, reason: pool.reason ?? "pool_not_eligible", raw: pool.raw };
    }
    const row = pool.raw as Record<string, unknown> | undefined;
    if (!row || typeof row !== "object") {
      return { ok: false, reason: "pool_metadata_missing" };
    }

    const mintA = asPubkey(getPath(row, "mintA.address")) ?? asPubkey(getPath(row, "mintA")) ?? asPubkey(getPath(row, "baseMint"));
    const mintB = asPubkey(getPath(row, "mintB.address")) ?? asPubkey(getPath(row, "mintB")) ?? asPubkey(getPath(row, "quoteMint"));
    const vaultA = asPubkey(getPath(row, "vaultA")) ?? asPubkey(getPath(row, "vault.A")) ?? asPubkey(getPath(row, "baseVault"));
    const vaultB = asPubkey(getPath(row, "vaultB")) ?? asPubkey(getPath(row, "vault.B")) ?? asPubkey(getPath(row, "quoteVault"));
    const authority = asPubkey(getPath(row, "authority")) ?? asPubkey(getPath(row, "poolAuthority"));
    const ammConfig =
      asPubkey(getPath(row, "configId")) ??
      asPubkey(getPath(row, "ammConfig")) ??
      asPubkey(getPath(row, "ammConfigId")) ??
      asPubkey(getPath(row, "config.id"));
    const observationState =
      asPubkey(getPath(row, "observationState")) ??
      asPubkey(getPath(row, "observationId")) ??
      asPubkey(getPath(row, "observation.id")) ??
      asPubkey("Sysvar1111111111111111111111111111111111111");

    if (!mintA || !mintB || !vaultA || !vaultB || !authority || !ammConfig || !observationState) {
      return {
        ok: false,
        reason: "pool_metadata_incomplete",
        raw: {
          mintA,
          mintB,
          vaultA,
          vaultB,
          authority,
          ammConfig,
          observationState
        }
      };
    }

    if (!(
      (mintA === inputMint && mintB === outputMint) ||
      (mintA === outputMint && mintB === inputMint)
    )) {
      return {
        ok: false,
        reason: `pool_mints_mismatch:${mintA}:${mintB}:${inputMint}:${outputMint}`
      };
    }

    const inputIsA = mintA === inputMint;
    const feeNumerator =
      asBigInt(getPath(row, "tradeFeeNumerator")) ??
      asBigInt(getPath(row, "tradeFeeRateNumerator")) ??
      asBigInt(getPath(row, "tradeFeeRate"));
    const feeDenominator =
      asBigInt(getPath(row, "tradeFeeDenominator")) ??
      asBigInt(getPath(row, "tradeFeeRateDenominator")) ??
      1_000_000n;
    return {
      ok: true,
      keys: {
        poolId: pool.poolId,
        programId: pool.programId || RAYDIUM_CPMM_PROGRAM_ID,
        authority,
        ammConfig,
        observationState,
        mintA,
        mintB,
        vaultA,
        vaultB,
        inputMint,
        outputMint,
        inputVault: inputIsA ? vaultA : vaultB,
        outputVault: inputIsA ? vaultB : vaultA,
        inputTokenProgram:
          asPubkey(getPath(row, inputIsA ? "mintAProgramId" : "mintBProgramId")) ?? asPubkey(getPath(row, "tokenProgramId")),
        outputTokenProgram:
          asPubkey(getPath(row, inputIsA ? "mintBProgramId" : "mintAProgramId")) ?? asPubkey(getPath(row, "tokenProgramId")),
        feeNumerator,
        feeDenominator: feeDenominator > 0n ? feeDenominator : undefined
      }
    };
  }

  logAttempt(meta: Record<string, unknown>): void {
    this.logger.info(
      {
        ...meta,
        poolKinds: this.getSupportedPoolKinds(),
        directEnabled: this.cfg.execution.router.raydium.directEntryEnabled
      },
      "raydium direct entry attempt"
    );
  }
}

function inferPoolKind(rawType: string): "cpmm" | "clmm" | "unknown" {
  const t = rawType.toLowerCase();
  if (!t) return "unknown";
  if (t.includes("concentrated") || t.includes("clmm")) return "clmm";
  if (t.includes("cpmm") || t.includes("standard") || t.includes("amm")) return "cpmm";
  return "unknown";
}

function asPubkey(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length >= 32 ? s : undefined;
}

function asBigInt(v: unknown): bigint | undefined {
  if (v === null || v === undefined) return undefined;
  try {
    return BigInt(String(v));
  } catch {
    return undefined;
  }
}

function getPath(row: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = row;
  for (const part of parts) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  return await fetch(input, { ...init, signal });
}
