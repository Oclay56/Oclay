import crypto from "node:crypto";
import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { DexPairSnapshot, Position, TradeExecutionResult, TradeIntent } from "../domain/types";
import type { JupiterUltraClient } from "../providers/jupiterUltra";
import type { Repos } from "../storage/repos";
import { parsePriceImpactPct } from "../providers/jupiterUltra";
import { modelPaperBuy, modelPaperSell } from "./paperModel";
import { lamportsToUsdNumber } from "../utils/fixedPoint";

export async function executePaperBuy(params: {
  cfg: AppConfig;
  intent: TradeIntent;
  bestPair: DexPairSnapshot | null;
  jup: JupiterUltraClient;
  repos: Repos;
  logger: Logger;
}): Promise<{ position: Position; execution: TradeExecutionResult }> {
  const { cfg, intent, bestPair, jup, repos, logger } = params;

  const quote = await jup.getOrder({
    inputMint: cfg.assets.baseAssetMint,
    outputMint: intent.mint,
    amount: intent.amountIn.toString(),
    slippageBps: intent.slippageBps
  });

  const modeled = modelPaperBuy({
    cfg,
    quoteOutAmount: BigInt(quote.outAmount),
    quoteInAmount: BigInt(quote.inAmount),
    priceImpactPct: parsePriceImpactPct(quote.priceImpactPct)
  });
  const modeledRaw = {
    ...modeled,
    tokenOut: modeled.tokenOut.toString(),
    entryBaseCost: modeled.entryBaseCost.toString(),
    networkFeeLamports: modeled.networkFeeLamports.toString()
  };
  const tokenOut = modeled.tokenOut;
  const execution: TradeExecutionResult = {
    intentId: intent.id,
    ok: true,
    executedAtMs: Date.now(),
    inAmount: modeled.entryBaseCost,
    outAmount: tokenOut,
    raw: { quote: quote.raw, modeled: modeledRaw }
  };

  const entryPriceUsd = bestPair?.priceUsd ? Number(bestPair.priceUsd) : undefined;
  const positionId = intent.positionId ?? crypto.randomUUID();
  const existing = repos.getPositionById(positionId);
  let position: Position;
  if (existing && existing.status !== "CLOSED") {
    const nextEntryBase = existing.entryBaseAmount + modeled.entryBaseCost;
    const nextEntryToken = existing.entryTokenAmount + tokenOut;
    const nextCurrent = existing.currentTokenAmount + tokenOut;
    const nextMaxSeen =
      existing.maxSeenPriceUsd !== undefined && entryPriceUsd !== undefined
        ? Math.max(existing.maxSeenPriceUsd, entryPriceUsd)
        : existing.maxSeenPriceUsd ?? entryPriceUsd;
    const nextStage = intent.intentKind === "ENTRY_SCALE" ? "SCALED" : existing.stage;
    repos.updatePosition({
      id: existing.id,
      status: "OPEN",
      stage: nextStage,
      sniperMode: existing.sniperMode || intent.intentKind === "ENTRY_TEST",
      entryBaseAmount: nextEntryBase as any,
      entryTokenAmount: nextEntryToken as any,
      currentTokenAmount: nextCurrent,
      maxSeenPriceUsd: nextMaxSeen
    } as any);
    position = {
      ...existing,
      status: "OPEN",
      stage: nextStage,
      sniperMode: existing.sniperMode || intent.intentKind === "ENTRY_TEST",
      entryBaseAmount: nextEntryBase,
      entryTokenAmount: nextEntryToken,
      currentTokenAmount: nextCurrent,
      maxSeenPriceUsd: nextMaxSeen
    };
  } else {
    const sniperMode = intent.intentKind === "ENTRY_TEST";
    position = {
      id: positionId,
      mint: intent.mint,
      mode: "paper",
      status: "OPEN",
      stage: sniperMode ? "TEST" : "FULL",
      sniperMode,
      tpStep: 0,
      openedAtMs: Date.now(),
      baseMint: intent.baseMint,
      entryBaseAmount: modeled.entryBaseCost,
      entryTokenAmount: tokenOut,
      initialTokenAmount: tokenOut,
      currentTokenAmount: tokenOut,
      entryPriceUsd,
      maxSeenPriceUsd: entryPriceUsd
    };
    repos.createPosition(position);
  }

  repos.insertExecution({
    id: crypto.randomUUID(),
    intentId: intent.id,
    positionId: position.id,
    mint: intent.mint,
    side: "BUY",
    mode: "paper",
    requestedAtMs: intent.createdAtMs,
    executedAtMs: execution.executedAtMs,
    ok: true,
    inAmount: modeled.entryBaseCost,
    outAmount: tokenOut,
    slippageBps: intent.slippageBps,
    raw: { quote: quote.raw, modeled: modeledRaw }
  });

  logger.info(
    { mint: intent.mint, tokenOut: tokenOut.toString(), entryBaseCost: modeled.entryBaseCost.toString(), model: cfg.paper.model },
    "paper buy executed"
  );
  return { position, execution };
}

export async function executePaperSell(params: {
  cfg: AppConfig;
  position: Position;
  intent: TradeIntent;
  amountIn?: bigint;
  bestPair: DexPairSnapshot | null;
  jup: JupiterUltraClient;
  repos: Repos;
  logger: Logger;
  baseAssetUsdPrice: number | null;
  reason: string;
}): Promise<TradeExecutionResult> {
  const { cfg, position, intent, bestPair, jup, repos, logger, baseAssetUsdPrice, reason } = params;
  const intentId = intent.id;
  const requestedAtMs = intent.createdAtMs;
  const currentAmount = position.currentTokenAmount > 0n ? position.currentTokenAmount : position.entryTokenAmount;
  const requestedAmount = params.amountIn ?? intent.amountIn;
  const sellAmount = requestedAmount <= currentAmount ? requestedAmount : currentAmount;

  let quote;
  try {
    quote = await jup.getOrder({
      inputMint: position.mint,
      outputMint: cfg.assets.baseAssetMint,
      amount: sellAmount.toString(),
      slippageBps: cfg.execution.slippageBpsExit
    });
  } catch (err) {
    repos.insertExecution({
      id: crypto.randomUUID(),
      intentId,
      positionId: position.id,
      mint: position.mint,
      side: "SELL",
      mode: "paper",
      requestedAtMs,
      executedAtMs: Date.now(),
      ok: false,
      err: String(err),
      slippageBps: cfg.execution.slippageBpsExit
    });
    throw err;
  }

  const modeled = modelPaperSell({
    cfg,
    quoteOutAmount: BigInt(quote.outAmount),
    priceImpactPct: parsePriceImpactPct(quote.priceImpactPct)
  });
  const modeledRaw = {
    ...modeled,
    baseOut: modeled.baseOut.toString(),
    networkFeeLamports: modeled.networkFeeLamports.toString()
  };
  const baseOut = modeled.baseOut;
  const execution: TradeExecutionResult = {
    intentId,
    ok: true,
    executedAtMs: Date.now(),
    inAmount: sellAmount,
    outAmount: baseOut,
    raw: { quote: quote.raw, modeled: modeledRaw }
  };

  const exitPriceUsd = bestPair?.priceUsd ? Number(bestPair.priceUsd) : undefined;
  let pnlUsd: number | undefined;
  const remaining = currentAmount > sellAmount ? currentAmount - sellAmount : 0n;
  const totalExitBase = (position.exitBaseAmount ?? 0n) + baseOut;
  const closed = remaining <= BigInt(cfg.execution.positionDustAtoms);
  const nextTpStep = Math.max(
    position.tpStep,
    intent.intentKind === "EXIT_TP1" ? 1 : intent.intentKind === "EXIT_TP2" ? 2 : intent.intentKind === "EXIT_TP3" ? 3 : position.tpStep
  );
  if (closed && baseAssetUsdPrice && baseAssetUsdPrice > 0) {
    const pnlLamports = totalExitBase - position.entryBaseAmount;
    pnlUsd = lamportsToUsdNumber(pnlLamports, baseAssetUsdPrice);
  }

  repos.updatePosition({
    id: position.id,
    status: closed ? "CLOSED" : "OPEN",
    closedAtMs: closed ? Date.now() : undefined,
    exitBaseAmount: totalExitBase as any,
    exitPriceUsd,
    pnlUsd,
    currentTokenAmount: remaining,
    tpStep: nextTpStep
  } as any);

  repos.insertExecution({
    id: crypto.randomUUID(),
    intentId,
    positionId: position.id,
    mint: position.mint,
    side: "SELL",
    mode: "paper",
    requestedAtMs,
    executedAtMs: execution.executedAtMs,
    ok: true,
    inAmount: sellAmount,
    outAmount: baseOut,
    slippageBps: cfg.execution.slippageBpsExit,
    raw: { quote: quote.raw, reason, modeled: modeledRaw }
  });

  logger.info({ mint: position.mint, baseOut: baseOut.toString(), reason, model: cfg.paper.model }, "paper sell executed");
  return execution;
}
