import crypto from "node:crypto";
import type { Logger } from "pino";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountMeta,
  type Keypair
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import type { AppConfig } from "../config/schema";
import type { DexPairSnapshot, TradeExecutionResult, TradeIntent } from "../domain/types";
import type { Repos } from "../storage/repos";
import type { SolanaRpc } from "../providers/solanaRpc";
import type { RaydiumProvider } from "../providers/raydium";
import { sendAndConfirmWithRetries } from "./sendAndConfirm";
import { simulateOrThrow } from "./simulate";
import { reconcileSwapFromChain } from "./reconcile";

const DEFAULT_FEE_NUMERATOR = 25n;
const DEFAULT_FEE_DENOMINATOR = 10_000n;

export async function executeRaydiumDirectBuy(params: {
  cfg: AppConfig;
  intent: TradeIntent;
  bestPair: DexPairSnapshot | null;
  wallet: Keypair;
  rpc: SolanaRpc;
  raydium: RaydiumProvider;
  repos: Repos;
  logger: Logger;
}): Promise<TradeExecutionResult> {
  const { cfg, intent, bestPair, wallet, rpc, raydium, repos, logger } = params;
  const requestedAtMs = intent.createdAtMs;

  const fail = (err: string, raw?: unknown): TradeExecutionResult => ({
    intentId: intent.id,
    ok: false,
    err,
    executedAtMs: Date.now(),
    inAmount: intent.amountIn,
    raw
  });

  if (!raydium.canAttemptDirectEntry(bestPair)) {
    return fail("raydium_direct_not_eligible");
  }

  try {
    const pool = await raydium.resolveDirectPool(bestPair);
    if (!pool.eligible || !pool.poolId) {
      return fail(pool.reason ?? "raydium_pool_not_eligible", { pool });
    }
    if (pool.poolKind !== "cpmm") {
      return fail(`raydium_pool_kind_unsupported:${pool.poolKind ?? "unknown"}`, { pool });
    }

    const keysResolved = raydium.resolveCpmmSwapKeys({
      pool,
      inputMint: cfg.assets.baseAssetMint,
      outputMint: intent.mint
    });
    if (!keysResolved.ok) {
      return fail(`raydium_cpmm_keys_error:${keysResolved.reason}`, {
        pool,
        cpmm: keysResolved.raw
      });
    }
    const keys = keysResolved.keys;

    const reserveIn = await readTokenBalanceAtoms(rpc, keys.inputVault);
    const reserveOut = await readTokenBalanceAtoms(rpc, keys.outputVault);
    if (reserveIn <= 0n || reserveOut <= 0n) {
      return fail("raydium_cpmm_zero_reserves", {
        reserveIn: reserveIn.toString(),
        reserveOut: reserveOut.toString(),
        keys
      });
    }

    const expectedOut = computeCpmmOut({
      amountIn: intent.amountIn,
      reserveIn,
      reserveOut,
      feeNumerator: keys.feeNumerator ?? DEFAULT_FEE_NUMERATOR,
      feeDenominator: keys.feeDenominator ?? DEFAULT_FEE_DENOMINATOR
    });
    if (expectedOut <= 0n) {
      return fail("raydium_cpmm_expected_out_zero", {
        expectedOut: expectedOut.toString(),
        reserveIn: reserveIn.toString(),
        reserveOut: reserveOut.toString()
      });
    }
    const minOut = applySlippage(expectedOut, intent.slippageBps);

    raydium.logAttempt({
      mint: intent.mint,
      pair: bestPair?.pairAddress,
      poolId: pool.poolId,
      poolKind: pool.poolKind,
      mode: "cpmm_direct_local_builder",
      expectedOut: expectedOut.toString(),
      minOut: minOut.toString()
    });

    const built = await buildAndSimulateCpmmBuyTx({
      cfg,
      rpc,
      wallet,
      keys,
      amountIn: intent.amountIn,
      minOut,
      logger
    });

    const send = await sendAndConfirmWithRetries({
      rpc,
      rawTx: Buffer.from(built.tx.serialize()),
      maxRetries: cfg.execution.maxRetries,
      confirmTimeoutMs: cfg.execution.confirmTimeoutMs,
      landing: cfg.execution.landing,
      logger
    });
    if (!send.confirmed || !send.signature) {
      return fail(
        send.err === "chain_error"
          ? `post_send_uncertain:chain_error:${String(send.chainErr ?? "unknown_chain_error")}`
          : `post_send_uncertain:send_not_confirmed:${String(send.err ?? "unknown")}`,
        {
          pool,
          keys,
          build: built.meta,
          send
        }
      );
    }

    const reconcile = await reconcileSwapFromChain({
      rpc,
      signature: send.signature,
      wallet: wallet.publicKey.toBase58(),
      inputMint: cfg.assets.baseAssetMint,
      outputMint: intent.mint,
      intendedInputAmount: intent.amountIn,
      side: "BUY",
      positionDustAtoms: BigInt(cfg.execution.positionDustAtoms)
    });
    if (!reconcile.reconcileOk) {
      return fail(`post_send_uncertain:reconcile_failed:${reconcile.reconcileReason ?? "unknown_reason"}`, {
        pool,
        keys,
        signature: send.signature,
        build: built.meta,
        reconcile
      });
    }

    const execution: TradeExecutionResult = {
      intentId: intent.id,
      ok: true,
      signature: send.signature,
      executedAtMs: Date.now(),
      inAmount: reconcile.reconciledInAmount ?? intent.amountIn,
      outAmount: reconcile.reconciledOutAmount,
      raw: toJsonSafe({
        entryPath: "raydium_direct",
        pool,
        keys,
        build: built.meta,
        reconcile
      })
    };

    repos.insertExecution({
      id: crypto.randomUUID(),
      intentId: intent.id,
      positionId: intent.positionId,
      mint: intent.mint,
      side: "BUY",
      mode: "live",
      requestedAtMs,
      executedAtMs: execution.executedAtMs,
      ok: true,
      txSig: execution.signature,
      inAmount: execution.inAmount,
      outAmount: execution.outAmount,
      slippageBps: intent.slippageBps,
      raw: execution.raw
    });
    logger.info({ mint: intent.mint, sig: execution.signature, poolId: pool.poolId }, "raydium direct buy executed");
    return execution;
  } catch (err) {
    logger.warn({ mint: intent.mint, err: String(err) }, "raydium direct buy failed");
    return fail(String(err));
  }
}

async function buildAndSimulateCpmmBuyTx(params: {
  cfg: AppConfig;
  rpc: SolanaRpc;
  wallet: Keypair;
  keys: {
    poolId: string;
    programId: string;
    authority: string;
    ammConfig: string;
    observationState: string;
    inputMint: string;
    outputMint: string;
    inputVault: string;
    outputVault: string;
    inputTokenProgram?: string;
    outputTokenProgram?: string;
  };
  amountIn: bigint;
  minOut: bigint;
  logger: Logger;
}): Promise<{ tx: VersionedTransaction; meta: Record<string, unknown> }> {
  const { cfg, rpc, wallet, keys, amountIn, minOut, logger } = params;
  const walletPk = wallet.publicKey;
  const inputMint = new PublicKey(keys.inputMint);
  const outputMint = new PublicKey(keys.outputMint);
  const inputTokenProgram = new PublicKey(keys.inputTokenProgram ?? TOKEN_PROGRAM_ID.toBase58());
  const outputTokenProgram = new PublicKey(keys.outputTokenProgram ?? TOKEN_PROGRAM_ID.toBase58());

  const userInputAta = getAssociatedTokenAddressSync(inputMint, walletPk, false, inputTokenProgram);
  const userOutputAta = getAssociatedTokenAddressSync(outputMint, walletPk, false, outputTokenProgram);

  const prepIxs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }),
    createAssociatedTokenAccountIdempotentInstruction(walletPk, userInputAta, walletPk, inputMint, inputTokenProgram),
    createAssociatedTokenAccountIdempotentInstruction(walletPk, userOutputAta, walletPk, outputMint, outputTokenProgram)
  ];
  if (keys.inputMint === NATIVE_MINT.toBase58()) {
    prepIxs.push(
      SystemProgram.transfer({
        fromPubkey: walletPk,
        toPubkey: userInputAta,
        lamports: toSafeLamportsNumber(amountIn)
      })
    );
    prepIxs.push(createSyncNativeInstruction(userInputAta));
  }

  const swapKeys: AccountMeta[] = [
    { pubkey: walletPk, isSigner: true, isWritable: true },
    { pubkey: new PublicKey(keys.authority), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(keys.ammConfig), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(keys.poolId), isSigner: false, isWritable: true },
    { pubkey: userInputAta, isSigner: false, isWritable: true },
    { pubkey: userOutputAta, isSigner: false, isWritable: true },
    { pubkey: new PublicKey(keys.inputVault), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(keys.outputVault), isSigner: false, isWritable: true },
    { pubkey: inputTokenProgram, isSigner: false, isWritable: false },
    { pubkey: outputTokenProgram, isSigner: false, isWritable: false },
    { pubkey: inputMint, isSigner: false, isWritable: false },
    { pubkey: outputMint, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(keys.observationState), isSigner: false, isWritable: true }
  ];

  const blockhash = await rpc.getLatestBlockhash();
  const candidates = cpmmSwapInstructionDataCandidates(amountIn, minOut);
  const simErrors: string[] = [];

  for (const candidate of candidates) {
    const swapIx = new TransactionInstruction({
      programId: new PublicKey(keys.programId),
      keys: swapKeys,
      data: candidate.data
    });
    const message = new TransactionMessage({
      payerKey: walletPk,
      recentBlockhash: blockhash.blockhash,
      instructions: [...prepIxs, swapIx]
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([wallet]);
    try {
      await simulateOrThrow(rpc, Buffer.from(tx.serialize()).toString("base64"));
      return {
        tx,
        meta: {
          candidate: candidate.name,
          minOut: minOut.toString(),
          amountIn: amountIn.toString(),
          blockhash: blockhash.blockhash
        }
      };
    } catch (err) {
      simErrors.push(`${candidate.name}:${String(err)}`);
    }
  }

  logger.debug({ simErrors }, "raydium cpmm direct candidates failed");
  throw new Error(`raydium_cpmm_build_or_simulate_failed:${simErrors.join("|")}`);
}

function cpmmSwapInstructionDataCandidates(amountIn: bigint, minOut: bigint): Array<{ name: string; data: Buffer }> {
  const amount = toU64Le(amountIn);
  const min = toU64Le(minOut);
  const anchorNames = [
    "global:swap_base_input",
    "global:swap_base_in",
    "global:swap",
    "global:swap_v2"
  ];
  const out = anchorNames.map((n) => ({
    name: `anchor:${n}`,
    data: Buffer.concat([anchorDiscriminator(n), amount, min])
  }));
  out.push({ name: "opcode:9", data: Buffer.concat([Buffer.from([9]), amount, min]) });
  out.push({ name: "opcode:1", data: Buffer.concat([Buffer.from([1]), amount, min]) });
  return out;
}

function anchorDiscriminator(namespaceAndName: string): Buffer {
  return crypto.createHash("sha256").update(namespaceAndName).digest().subarray(0, 8);
}

function toU64Le(v: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt.asUintN(64, v));
  return out;
}

function applySlippage(amount: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.floor(slippageBps)));
  return (amount * (10_000n - bps)) / 10_000n;
}

function computeCpmmOut(params: {
  amountIn: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  feeNumerator: bigint;
  feeDenominator: bigint;
}): bigint {
  const { amountIn, reserveIn, reserveOut, feeNumerator, feeDenominator } = params;
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n || feeDenominator <= 0n) return 0n;
  const feeAdjNumerator = feeDenominator > feeNumerator ? feeDenominator - feeNumerator : feeDenominator;
  const inAfterFee = (amountIn * feeAdjNumerator) / feeDenominator;
  if (inAfterFee <= 0n) return 0n;
  const numerator = inAfterFee * reserveOut;
  const denominator = reserveIn + inAfterFee;
  if (denominator <= 0n) return 0n;
  return numerator / denominator;
}

async function readTokenBalanceAtoms(rpc: SolanaRpc, tokenAccount: string): Promise<bigint> {
  try {
    const res = await rpc.getTokenAccountBalance(tokenAccount);
    return BigInt(res.value.amount);
  } catch {
    return 0n;
  }
}

function toJsonSafe<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_k, value) => (typeof value === "bigint" ? value.toString() : value))
  ) as T;
}

function toSafeLamportsNumber(v: bigint): number {
  if (v < 0n || v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`amount_out_of_range_for_lamports_number:${v.toString()}`);
  }
  return Number(v);
}
