import type { AppConfig } from "../config/schema";
import type { Position } from "../domain/types";
import type { SolanaRpc } from "../providers/solanaRpc";

export interface ResolvedExitAmount {
  amount: bigint;
  availableAmount: bigint;
  bufferedAmount: bigint;
  walletBalance: bigint;
  trackedAmount: bigint;
  lookupOk: boolean;
  reason: string;
}

export async function resolveLiveExitAmount(params: {
  cfg: AppConfig;
  rpc: SolanaRpc;
  wallet: string;
  position: Position;
}): Promise<ResolvedExitAmount> {
  const { cfg, rpc, wallet, position } = params;
  let walletBalance = 0n;
  let lookupOk = true;
  try {
    const accts = await rpc.getParsedTokenAccountsByOwner({ owner: wallet, mint: position.mint });
    for (const a of accts.value) {
      const amountStr = (a.account.data as any)?.parsed?.info?.tokenAmount?.amount;
      if (amountStr !== undefined && amountStr !== null) walletBalance += BigInt(String(amountStr));
    }
  } catch (err) {
    lookupOk = false;
    return {
      amount: 0n,
      availableAmount: 0n,
      bufferedAmount: 0n,
      walletBalance: 0n,
      trackedAmount: trackedPositionAmount(position),
      lookupOk,
      reason: `wallet_balance_lookup_failed:${String(err)}`
    };
  }

  const trackedAmount = trackedPositionAmount(position);
  const capped = trackedAmount > 0n ? minBigInt(walletBalance, trackedAmount) : walletBalance;
  const bufferBps = BigInt(Math.max(0, Math.min(2_000, cfg.execution.sellAmountBufferBps)));
  const buffered = (capped * (10_000n - bufferBps)) / 10_000n;
  const amount = buffered > 0n ? buffered : capped;

  return {
    amount,
    availableAmount: capped,
    bufferedAmount: amount,
    walletBalance,
    trackedAmount,
    lookupOk,
    reason: `wallet=${walletBalance.toString()} tracked=${trackedAmount.toString()} available=${capped.toString()} buffered=${amount.toString()}`
  };
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function trackedPositionAmount(position: Position): bigint {
  return position.currentTokenAmount > 0n ? position.currentTokenAmount : position.entryTokenAmount > 0n ? position.entryTokenAmount : 0n;
}
