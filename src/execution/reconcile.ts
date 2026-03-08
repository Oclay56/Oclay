import type { SolanaRpc } from "../providers/solanaRpc";

export interface ReconcileSwapCommonParams {
  rpc: SolanaRpc;
  wallet: string;
  inputMint: string;
  outputMint: string;
  intendedInputAmount: bigint;
  side: "BUY" | "SELL";
  positionDustAtoms: bigint;
}

export interface ReconcileSwapParams extends ReconcileSwapCommonParams {
  signature: string;
}

export interface ReconcileSwapResult {
  reconcileOk: boolean;
  reconcileReason?: string;
  reconciledInAmount?: bigint;
  reconciledOutAmount?: bigint;
  tokenInDelta?: bigint;
  tokenOutDelta?: bigint;
  lamportDelta?: bigint;
  lamportDeltaExFee?: bigint;
  feeLamports?: bigint;
  raw?: unknown;
}

export async function reconcileSwapFromChain(params: ReconcileSwapParams): Promise<ReconcileSwapResult> {
  const tx = await params.rpc.getTransactionWithRetry(params.signature, {
    maxSupportedTransactionVersion: 0,
    retries: 8,
    delayMs: 700
  });
  if (!tx?.meta) {
    return { reconcileOk: false, reconcileReason: "missing_transaction_meta" };
  }

  const meta: any = tx.meta;
  const tokenDeltas = computeWalletTokenDeltas(meta, params.wallet);
  const tokenInDelta = tokenDeltas.get(params.inputMint) ?? 0n;
  const tokenOutDelta = tokenDeltas.get(params.outputMint) ?? 0n;

  const { lamportDelta, lamportDeltaExFee, feeLamports } = computeWalletLamportDelta(tx, params.wallet);
  return resolveReconcile({
    side: params.side,
    intendedInputAmount: params.intendedInputAmount,
    positionDustAtoms: params.positionDustAtoms,
    tokenInDelta,
    tokenOutDelta,
    lamportDelta,
    lamportDeltaExFee,
    feeLamports,
    raw: tx
  });
}

export async function reconcileSwapAcrossSignatures(params: ReconcileSwapCommonParams & {
  signatures: string[];
}): Promise<ReconcileSwapResult> {
  const signatures = params.signatures.filter((s) => s && s.length > 0);
  if (!signatures.length) {
    return { reconcileOk: false, reconcileReason: "missing_signatures" };
  }

  let tokenInDelta = 0n;
  let tokenOutDelta = 0n;
  let lamportDelta = 0n;
  let lamportDeltaExFee = 0n;
  let feeLamports = 0n;
  let haveLamportData = false;
  const rawTxs: any[] = [];

  for (const sig of signatures) {
    const tx = await params.rpc.getTransactionWithRetry(sig, {
      maxSupportedTransactionVersion: 0,
      retries: 8,
      delayMs: 700
    });
    if (!tx?.meta) {
      return { reconcileOk: false, reconcileReason: `missing_transaction_meta:${sig}` };
    }
    rawTxs.push(tx);
    const deltas = computeWalletTokenDeltas(tx.meta, params.wallet);
    tokenInDelta += deltas.get(params.inputMint) ?? 0n;
    tokenOutDelta += deltas.get(params.outputMint) ?? 0n;
    const lamports = computeWalletLamportDelta(tx, params.wallet);
    if (lamports.lamportDelta !== undefined) {
      lamportDelta += lamports.lamportDelta;
      haveLamportData = true;
    }
    if (lamports.lamportDeltaExFee !== undefined) {
      lamportDeltaExFee += lamports.lamportDeltaExFee;
      haveLamportData = true;
    }
    if (lamports.feeLamports !== undefined) {
      feeLamports += lamports.feeLamports;
      haveLamportData = true;
    }
  }

  return resolveReconcile({
    side: params.side,
    intendedInputAmount: params.intendedInputAmount,
    positionDustAtoms: params.positionDustAtoms,
    tokenInDelta,
    tokenOutDelta,
    lamportDelta: haveLamportData ? lamportDelta : undefined,
    lamportDeltaExFee: haveLamportData ? lamportDeltaExFee : undefined,
    feeLamports: haveLamportData ? feeLamports : undefined,
    raw: { signatures, txCount: rawTxs.length, txs: rawTxs }
  });
}

function resolveReconcile(params: {
  side: "BUY" | "SELL";
  intendedInputAmount: bigint;
  positionDustAtoms: bigint;
  tokenInDelta: bigint;
  tokenOutDelta: bigint;
  lamportDelta?: bigint;
  lamportDeltaExFee?: bigint;
  feeLamports?: bigint;
  raw: unknown;
}): ReconcileSwapResult {
  const { side, intendedInputAmount, positionDustAtoms, tokenInDelta, tokenOutDelta, lamportDelta, lamportDeltaExFee, feeLamports, raw } = params;

  const inputSpent = tokenInDelta < 0n ? -tokenInDelta : 0n;
  const outputReceived = tokenOutDelta > 0n ? tokenOutDelta : 0n;

  if (side === "BUY") {
    const lamportInputSpent = lamportDeltaExFee !== undefined && lamportDeltaExFee < 0n ? -lamportDeltaExFee : 0n;
    const resolvedInputSpent = inputSpent > 0n ? inputSpent : lamportInputSpent;
    if (resolvedInputSpent <= 0n) {
      return {
        reconcileOk: false,
        reconcileReason: "buy_input_unresolved",
        tokenInDelta,
        tokenOutDelta,
        lamportDelta,
        lamportDeltaExFee,
        feeLamports,
        raw
      };
    }
    if (outputReceived <= positionDustAtoms) {
      return {
        reconcileOk: false,
        reconcileReason: "buy_output_below_dust",
        tokenInDelta,
        tokenOutDelta,
        lamportDelta,
        lamportDeltaExFee,
        feeLamports,
        raw
      };
    }
    return {
      reconcileOk: true,
      reconciledInAmount: resolvedInputSpent,
      reconciledOutAmount: outputReceived,
      tokenInDelta,
      tokenOutDelta,
      lamportDelta,
      lamportDeltaExFee,
      feeLamports,
      raw
    };
  }

  const minimumInput = (intendedInputAmount * 95n) / 100n;
  if (inputSpent < minimumInput) {
    return {
      reconcileOk: false,
      reconcileReason: `sell_input_underfilled:${inputSpent.toString()}<${minimumInput.toString()}`,
      tokenInDelta,
      tokenOutDelta,
      lamportDelta,
      lamportDeltaExFee,
      feeLamports,
      raw
    };
  }
  if (outputReceived <= 0n) {
    return {
      reconcileOk: false,
      reconcileReason: "sell_output_unresolved",
      tokenInDelta,
      tokenOutDelta,
      lamportDelta,
      lamportDeltaExFee,
      feeLamports,
      raw
    };
  }

  return {
    reconcileOk: true,
    reconciledInAmount: inputSpent,
    reconciledOutAmount: outputReceived,
    tokenInDelta,
    tokenOutDelta,
    lamportDelta,
    lamportDeltaExFee,
    feeLamports,
    raw
  };
}

function computeWalletTokenDeltas(meta: any, wallet: string): Map<string, bigint> {
  const preByMint = new Map<string, bigint>();
  const postByMint = new Map<string, bigint>();

  for (const b of meta.preTokenBalances ?? []) {
    if (String(b?.owner ?? "") !== wallet) continue;
    const mint = String(b?.mint ?? "");
    if (!mint) continue;
    const amount = extractTokenAmount(b);
    preByMint.set(mint, (preByMint.get(mint) ?? 0n) + amount);
  }

  for (const b of meta.postTokenBalances ?? []) {
    if (String(b?.owner ?? "") !== wallet) continue;
    const mint = String(b?.mint ?? "");
    if (!mint) continue;
    const amount = extractTokenAmount(b);
    postByMint.set(mint, (postByMint.get(mint) ?? 0n) + amount);
  }

  const mints = new Set<string>([...preByMint.keys(), ...postByMint.keys()]);
  const out = new Map<string, bigint>();
  for (const mint of mints) {
    out.set(mint, (postByMint.get(mint) ?? 0n) - (preByMint.get(mint) ?? 0n));
  }
  return out;
}

function extractTokenAmount(balance: any): bigint {
  const raw = balance?.uiTokenAmount?.amount;
  if (raw === undefined || raw === null) return 0n;
  try {
    return BigInt(String(raw));
  } catch {
    return 0n;
  }
}

function computeWalletLamportDelta(
  tx: any,
  wallet: string
): { lamportDelta?: bigint; lamportDeltaExFee?: bigint; feeLamports?: bigint } {
  const meta = tx?.meta as any;
  const message = tx?.transaction?.message as any;
  const keys = (message?.staticAccountKeys ?? message?.accountKeys ?? []).map((k: any) =>
    k?.toBase58 ? k.toBase58() : String(k)
  );
  const idx = keys.findIndex((k: string) => k === wallet);
  if (idx < 0) return {};

  const pre = meta?.preBalances?.[idx];
  const post = meta?.postBalances?.[idx];
  if (pre === undefined || post === undefined) return {};
  const fee = BigInt(meta?.fee ?? 0);
  const delta = BigInt(post) - BigInt(pre);
  return {
    lamportDelta: delta,
    lamportDeltaExFee: delta + fee,
    feeLamports: fee
  };
}
