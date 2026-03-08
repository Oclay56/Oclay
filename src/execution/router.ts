import type { Logger } from "pino";
import type { Keypair } from "@solana/web3.js";
import crypto from "node:crypto";
import type { AppConfig } from "../config/schema";
import type { DexPairSnapshot, TradeExecutionResult, TradeIntent } from "../domain/types";
import type { SolanaRpc } from "../providers/solanaRpc";
import type { JupiterUltraClient } from "../providers/jupiterUltra";
import type { Repos } from "../storage/repos";
import type { RaydiumProvider } from "../providers/raydium";
import { executeLiveBuy } from "./swap";
import { executeRaydiumDirectBuy } from "./raydiumSwap";

export async function executeRoutedLiveBuy(params: {
  cfg: AppConfig;
  intent: TradeIntent;
  bestPair: DexPairSnapshot | null;
  wallet: Keypair;
  rpc: SolanaRpc;
  jup: JupiterUltraClient;
  raydium: RaydiumProvider;
  repos: Repos;
  logger: Logger;
}): Promise<{ execution: TradeExecutionResult; entryPath: "raydium_direct" | "jupiter_fallback" | "jupiter_only" }> {
  const { cfg, intent, bestPair, wallet, rpc, jup, raydium, repos, logger } = params;
  const attemptIds: string[] = [];
  let attemptNo = 0;

  const recordAttempt = (params: {
    router: "raydium_direct" | "jupiter";
    execution: TradeExecutionResult;
    fallbackReason?: string;
  }) => {
    attemptNo += 1;
    const attemptId = crypto.randomUUID();
    attemptIds.push(attemptId);
    repos.insertExecutionAttempt({
      id: attemptId,
      intentId: intent.id,
      positionId: intent.positionId,
      mint: intent.mint,
      router: params.router,
      attemptNo,
      stage: classifyAttemptStage(params.execution.ok, params.execution.err),
      ok: params.execution.ok,
      txSig: params.execution.signature,
      err: params.execution.err,
      inAmount: params.execution.inAmount,
      outAmount: params.execution.outAmount,
      requestedAtMs: intent.createdAtMs,
      executedAtMs: params.execution.executedAtMs,
      raw:
        params.fallbackReason !== undefined
          ? withRouterMeta(params.execution.raw, { fallbackReason: params.fallbackReason })
          : params.execution.raw
    });
  };

  const finalizeExecutionRaw = (execution: TradeExecutionResult, entryPath: "raydium_direct" | "jupiter_fallback" | "jupiter_only", fallbackReason?: string) => {
    const routerMeta: Record<string, unknown> = {
      entryPath,
      attempts: attemptIds
    };
    if (fallbackReason) routerMeta.fallbackReason = fallbackReason;
    execution.raw = withRouterMeta(execution.raw, routerMeta);
    repos.patchLatestExecutionRawByIntent({
      intentId: intent.id,
      patch: { router: routerMeta }
    });
  };

  if (cfg.execution.router.entryMode === "jupiter_only") {
    const execution = await executeLiveBuy({ cfg, intent, wallet, rpc, jup, repos, logger });
    recordAttempt({ router: "jupiter", execution });
    finalizeExecutionRaw(execution, "jupiter_only");
    return { execution, entryPath: "jupiter_only" };
  }

  const ray = await executeRaydiumDirectBuy({
    cfg,
    intent,
    bestPair,
    wallet,
    rpc,
    raydium,
    repos,
    logger
  });
  recordAttempt({ router: "raydium_direct", execution: ray });
  if (ray.ok) {
    finalizeExecutionRaw(ray, "raydium_direct");
    return { execution: ray, entryPath: "raydium_direct" };
  }
  if (isPostSendUncertainError(ray.err)) {
    finalizeExecutionRaw(ray, "raydium_direct", ray.err);
    return { execution: ray, entryPath: "raydium_direct" };
  }

  const execution = await executeLiveBuy({ cfg, intent, wallet, rpc, jup, repos, logger });
  const fallbackReason = ray.err ?? "raydium_direct_failed";
  recordAttempt({ router: "jupiter", execution, fallbackReason });
  finalizeExecutionRaw(execution, "jupiter_fallback", fallbackReason);
  execution.raw = withRouterMeta(execution.raw, {
    entryPath: "jupiter_fallback",
    fallbackReason,
    attempts: attemptIds
  });
  return { execution, entryPath: "jupiter_fallback" };
}

function withRouterMeta(raw: unknown, router: Record<string, unknown>): unknown {
  const base = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    ...base,
    router
  };
}

function classifyAttemptStage(ok: boolean, err?: string): "BUILD" | "SIMULATE" | "SEND" | "CONFIRM" | "RECONCILE" {
  if (ok) return "RECONCILE";
  const msg = String(err ?? "").toLowerCase();
  if (!msg) return "BUILD";
  if (msg.includes("simulation")) return "SIMULATE";
  if (msg.includes("sendrawtransaction") || msg.includes("send_") || msg.includes("send_not_confirmed")) return "SEND";
  if (msg.includes("confirm") || msg.includes("chain_error")) return "CONFIRM";
  if (msg.includes("reconcile")) return "RECONCILE";
  return "BUILD";
}

function isPostSendUncertainError(err?: string): boolean {
  return String(err ?? "").toLowerCase().includes("post_send_uncertain");
}
