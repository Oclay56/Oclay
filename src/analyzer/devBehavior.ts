import { PublicKey } from "@solana/web3.js";
import type { RiskFlag } from "../domain/flags";
import type { SolanaRpc } from "../providers/solanaRpc";

export interface DevBehaviorResult {
  flags: RiskFlag[];
  creatorHoldingAmount?: bigint;
  creatorHoldingPct?: number;
  recentOutflowAmount?: bigint;
  recentOutflowPct?: number;
  creatorWallet?: string;
}

export async function analyzeDevBehavior(params: {
  rpc: SolanaRpc;
  mint: string;
  creatorWallet?: string;
  supplyAmount?: bigint;
}): Promise<DevBehaviorResult> {
  const flags: RiskFlag[] = [];
  const { rpc, mint, creatorWallet, supplyAmount } = params;

  if (!creatorWallet) {
    flags.push("DEV_WALLET_UNKNOWN");
    return { flags };
  }

  const creatorPk = new PublicKey(creatorWallet);
  const mintPk = new PublicKey(mint);

  let holding = 0n;
  try {
    const accts = await rpc.getParsedTokenAccountsByOwner({ owner: creatorWallet, mint });
    for (const a of accts.value) {
      const amountStr = (a.account.data as any)?.parsed?.info?.tokenAmount?.amount;
      if (amountStr) holding += BigInt(amountStr);
    }
  } catch {
    // ignore
  }

  let holdingPct: number | undefined;
  if (supplyAmount && supplyAmount > 0n) {
    holdingPct = Number((holding * 10_000n) / supplyAmount) / 100;
  }

  // Approximate recent dumping using pre/post token balances in recent creator wallet transactions.
  let outflow = 0n;
  try {
    const sigs = await rpc.getSignaturesForAddress(creatorWallet, { limit: 12 });
    for (const s of sigs) {
      let tx: any;
      try {
        tx = await rpc.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
      } catch (err) {
        if (String(err).includes("429")) break;
        continue;
      }
      if (!tx?.meta) continue;
      const pre = (tx.meta.preTokenBalances ?? []) as any[];
      const post = (tx.meta.postTokenBalances ?? []) as any[];

      // Map by accountIndex for the creator + mint.
      const preMap = new Map<number, bigint>();
      for (const b of pre) {
        if (b?.mint !== mint) continue;
        if (String(b?.owner ?? "") !== creatorWallet) continue;
        const idx = Number(b.accountIndex);
        const amt = b?.uiTokenAmount?.amount;
        if (Number.isFinite(idx) && amt !== undefined) preMap.set(idx, BigInt(String(amt)));
      }
      for (const b of post) {
        if (b?.mint !== mint) continue;
        if (String(b?.owner ?? "") !== creatorWallet) continue;
        const idx = Number(b.accountIndex);
        const postAmt = b?.uiTokenAmount?.amount;
        const preAmt = preMap.get(idx) ?? 0n;
        const postBig = postAmt !== undefined ? BigInt(String(postAmt)) : 0n;
        if (preAmt > postBig) outflow += preAmt - postBig;
      }
    }
  } catch {
    // ignore
  }

  let outflowPct: number | undefined;
  if (supplyAmount && supplyAmount > 0n) {
    outflowPct = Number((outflow * 10_000n) / supplyAmount) / 100;
    // Heuristic: creator moving >=0.5% of supply in recent tx window is suspicious for new tokens.
    if (outflow >= (supplyAmount * 5n) / 1000n) flags.push("DEV_DUMPING");
  }

  return {
    flags,
    creatorWallet,
    creatorHoldingAmount: holding,
    creatorHoldingPct: holdingPct,
    recentOutflowAmount: outflow,
    recentOutflowPct: outflowPct
  };
}
