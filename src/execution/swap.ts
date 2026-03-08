import crypto from "node:crypto";
import type { Logger } from "pino";
import type { Keypair } from "@solana/web3.js";
import { VersionedTransaction } from "@solana/web3.js";
import type { AppConfig } from "../config/schema";
import type { TradeExecutionResult, TradeIntent } from "../domain/types";
import type { JupiterUltraClient } from "../providers/jupiterUltra";
import type { SolanaRpc } from "../providers/solanaRpc";
import { simulateOrThrow } from "./simulate";
import { sendAndConfirmWithRetries } from "./sendAndConfirm";
import type { Repos } from "../storage/repos";
import { reconcileSwapFromChain } from "./reconcile";

export async function executeLiveBuy(params: {
  cfg: AppConfig;
  intent: TradeIntent;
  wallet: Keypair;
  rpc: SolanaRpc;
  jup: JupiterUltraClient;
  repos: Repos;
  logger: Logger;
}): Promise<TradeExecutionResult> {
  const { cfg, intent, wallet, rpc, jup, repos, logger } = params;
  const requestedAtMs = intent.createdAtMs;

  try {
    const order = await jup.getOrder({
      inputMint: cfg.assets.baseAssetMint,
      outputMint: intent.mint,
      amount: intent.amountIn.toString(),
      taker: wallet.publicKey.toBase58(),
      slippageBps: intent.slippageBps
    });

    const txBase64 = order.transaction;
    if (!txBase64 || typeof txBase64 !== "string") {
      throw new Error("Jupiter Ultra did not return a transaction (missing taker or unsupported route).");
    }

    await simulateOrThrow(rpc, txBase64);

    const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
    tx.sign([wallet]);
    const rawTx = Buffer.from(tx.serialize());

    const send = await sendAndConfirmWithRetries({
      rpc,
      rawTx,
      maxRetries: cfg.execution.maxRetries,
      confirmTimeoutMs: cfg.execution.confirmTimeoutMs,
      landing: cfg.execution.landing,
      logger
    });
    if (!send.confirmed || !send.signature) {
      throw new Error(
        send.err === "chain_error"
          ? `chain_error:${String(send.chainErr ?? "unknown_chain_error")}`
          : `send_not_confirmed:${String(send.err ?? "unknown")}`
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
      throw new Error(`reconcile_failed:${reconcile.reconcileReason ?? "unknown_reason"}`);
    }
    const raw = toJsonSafe({ quote: order.raw, reconcile });

    const execution: TradeExecutionResult = {
      intentId: intent.id,
      ok: true,
      signature: send.signature,
      executedAtMs: Date.now(),
      inAmount: reconcile.reconciledInAmount ?? intent.amountIn,
      outAmount: reconcile.reconciledOutAmount,
      raw
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
      ok: execution.ok,
      txSig: execution.signature,
      inAmount: execution.inAmount,
      outAmount: execution.outAmount,
      slippageBps: intent.slippageBps,
      raw
    });

    logger.info({ mint: intent.mint, sig: send.signature }, "live buy executed");
    return execution;
  } catch (err) {
    const execution: TradeExecutionResult = {
      intentId: intent.id,
      ok: false,
      err: String(err),
      executedAtMs: Date.now(),
      inAmount: intent.amountIn
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
      ok: false,
      err: execution.err,
      inAmount: intent.amountIn,
      slippageBps: intent.slippageBps
    });
    logger.warn({ mint: intent.mint, err: execution.err }, "live buy failed");
    return execution;
  }
}

export async function executeLiveSell(params: {
  cfg: AppConfig;
  intent: TradeIntent;
  wallet: Keypair;
  rpc: SolanaRpc;
  jup: JupiterUltraClient;
  repos: Repos;
  logger: Logger;
}): Promise<TradeExecutionResult> {
  const { cfg, intent, wallet, rpc, jup, repos, logger } = params;
  const requestedAtMs = intent.createdAtMs;

  try {
    const order = await jup.getOrder({
      inputMint: intent.mint,
      outputMint: cfg.assets.baseAssetMint,
      amount: intent.amountIn.toString(),
      taker: wallet.publicKey.toBase58(),
      slippageBps: intent.slippageBps
    });

    const txBase64 = order.transaction;
    if (!txBase64 || typeof txBase64 !== "string") {
      throw new Error("Jupiter Ultra did not return a transaction for SELL.");
    }

    await simulateOrThrow(rpc, txBase64);

    const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
    tx.sign([wallet]);
    const rawTx = Buffer.from(tx.serialize());

    const send = await sendAndConfirmWithRetries({
      rpc,
      rawTx,
      maxRetries: cfg.execution.maxRetries,
      confirmTimeoutMs: cfg.execution.confirmTimeoutMs,
      landing: cfg.execution.landing,
      logger
    });
    if (!send.confirmed || !send.signature) {
      throw new Error(
        send.err === "chain_error"
          ? `chain_error:${String(send.chainErr ?? "unknown_chain_error")}`
          : `send_not_confirmed:${String(send.err ?? "unknown")}`
      );
    }

    const reconcile = await reconcileSwapFromChain({
      rpc,
      signature: send.signature,
      wallet: wallet.publicKey.toBase58(),
      inputMint: intent.mint,
      outputMint: cfg.assets.baseAssetMint,
      intendedInputAmount: intent.amountIn,
      side: "SELL",
      positionDustAtoms: BigInt(cfg.execution.positionDustAtoms)
    });
    if (!reconcile.reconcileOk) {
      throw new Error(`reconcile_failed:${reconcile.reconcileReason ?? "unknown_reason"}`);
    }
    const raw = toJsonSafe({ quote: order.raw, reconcile });

    const execution: TradeExecutionResult = {
      intentId: intent.id,
      ok: true,
      signature: send.signature,
      executedAtMs: Date.now(),
      inAmount: reconcile.reconciledInAmount ?? intent.amountIn,
      outAmount: reconcile.reconciledOutAmount,
      raw
    };

    repos.insertExecution({
      id: crypto.randomUUID(),
      intentId: intent.id,
      positionId: intent.positionId,
      mint: intent.mint,
      side: "SELL",
      mode: "live",
      requestedAtMs,
      executedAtMs: execution.executedAtMs,
      ok: execution.ok,
      txSig: execution.signature,
      inAmount: execution.inAmount,
      outAmount: execution.outAmount,
      slippageBps: intent.slippageBps,
      raw
    });

    logger.info({ mint: intent.mint, sig: send.signature }, "live sell executed");
    return execution;
  } catch (err) {
    const execution: TradeExecutionResult = {
      intentId: intent.id,
      ok: false,
      err: String(err),
      executedAtMs: Date.now(),
      inAmount: intent.amountIn
    };
    repos.insertExecution({
      id: crypto.randomUUID(),
      intentId: intent.id,
      positionId: intent.positionId,
      mint: intent.mint,
      side: "SELL",
      mode: "live",
      requestedAtMs,
      executedAtMs: execution.executedAtMs,
      ok: false,
      err: execution.err,
      inAmount: intent.amountIn,
      slippageBps: intent.slippageBps
    });
    logger.warn({ mint: intent.mint, err: execution.err }, "live sell failed");
    return execution;
  }
}

function toJsonSafe<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_k, value) => (typeof value === "bigint" ? value.toString() : value))
  ) as T;
}
