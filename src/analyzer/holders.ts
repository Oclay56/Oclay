import { SystemProgram } from "@solana/web3.js";
import type { AppConfig } from "../config/schema";
import type { RiskFlag } from "../domain/flags";
import type { SolanaRpc } from "../providers/solanaRpc";

const BURN_ADDRESSES = new Set([
  "11111111111111111111111111111111",
  "1nc1nerator11111111111111111111111111111111"
]);

let largestAccountsCooldownUntilMs = 0;
const holdersCache = new Map<string, { atMs: number; result: HoldersResult }>();

export interface HoldersResult {
  flags: RiskFlag[];
  top1HolderPct?: number;
  top10HolderPct?: number;
  holderCountSampled: number;
}

export async function analyzeHolders(cfg: AppConfig, rpc: SolanaRpc, mintStr: string): Promise<HoldersResult> {
  const nowMs = Date.now();
  const cached = holdersCache.get(mintStr);
  if (cached && nowMs - cached.atMs <= cfg.analysis.holders.cacheTtlMs) {
    return { ...cached.result, flags: [...cached.result.flags] };
  }

  const flags: RiskFlag[] = [];

  let supplyAmount: bigint;
  try {
    const supplyResp = await rpc.getTokenSupply(mintStr);
    supplyAmount = BigInt(supplyResp.value.amount);
  } catch {
    flags.push("HOLDERS_UNKNOWN");
    return { flags, holderCountSampled: 0 };
  }
  if (supplyAmount === 0n) return { flags, holderCountSampled: 0 };

  let topAccounts: Array<{ address: string; amount: string }>;
  if (largestAccountsCooldownUntilMs > nowMs) {
    flags.push("HOLDERS_UNKNOWN");
    return { flags, holderCountSampled: 0 };
  }
  try {
    const largest = await rpc.getTokenLargestAccounts(mintStr);
    topAccounts = largest.value.slice(0, 12).map((x: any) => ({
      address: x.address?.toBase58 ? x.address.toBase58() : String(x.address),
      amount: String(x.amount)
    }));
  } catch (err) {
    if (String(err).includes("429")) {
      largestAccountsCooldownUntilMs = nowMs + cfg.analysis.holders.rateLimitCooldownMs;
    }
    flags.push("HOLDERS_UNKNOWN");
    return { flags, holderCountSampled: 0 };
  }

  const ownerTotals = new Map<string, bigint>();
  const ownerIsProgramCache = new Map<string, boolean>();

  for (const acc of topAccounts) {
    let parsed: any;
    try {
      parsed = await rpc.getParsedAccountInfo(acc.address);
    } catch {
      continue;
    }
    const info = (parsed.value as any)?.data?.parsed?.info;
    const owner = String(info?.owner ?? "");
    if (!owner) continue;
    if (BURN_ADDRESSES.has(owner)) continue;

    let isProgram = ownerIsProgramCache.get(owner);
    if (isProgram === undefined) {
      try {
        const ownerInfo = await rpc.getAccountInfo(owner);
        isProgram = ownerInfo ? !ownerInfo.owner.equals(SystemProgram.programId) : false;
      } catch {
        isProgram = false;
      }
      ownerIsProgramCache.set(owner, isProgram);
    }
    if (isProgram) continue;

    const amount = BigInt(acc.amount);
    ownerTotals.set(owner, (ownerTotals.get(owner) ?? 0n) + amount);
  }

  const holders = [...ownerTotals.entries()].sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1));
  const top1 = holders[0]?.[1] ?? 0n;
  const top10 = holders.slice(0, 10).reduce((sum, [, amt]) => sum + amt, 0n);

  const top1Pct = Number((top1 * 10_000n) / supplyAmount) / 100;
  const top10Pct = Number((top10 * 10_000n) / supplyAmount) / 100;

  if (top1Pct > cfg.analysis.holders.maxTop1Pct) flags.push("TOP1_TOO_LARGE");
  if (top10Pct > cfg.analysis.holders.maxTop10Pct) flags.push("TOP10_TOO_CONCENTRATED");

  const result: HoldersResult = {
    flags,
    top1HolderPct: top1Pct,
    top10HolderPct: top10Pct,
    holderCountSampled: holders.length
  };
  holdersCache.set(mintStr, { atMs: nowMs, result });
  if (holdersCache.size > 500) {
    const oldest = holdersCache.keys().next().value;
    if (oldest) holdersCache.delete(oldest);
  }
  return result;
}
