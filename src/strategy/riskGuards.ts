import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { TradeIntent } from "../domain/types";
import type { JupiterUltraClient } from "../providers/jupiterUltra";
import type { SolanaRpc } from "../providers/solanaRpc";
import type { Repos } from "../storage/repos";
import { lamportsToMicroUsd, microToUsdNumber, microToUsdString, usdToMicro } from "../utils/fixedPoint";

export interface RuntimeEntryRiskContext {
  cfg: AppConfig;
  repos: Repos;
  jup: JupiterUltraClient;
  rpc: SolanaRpc;
  logger: Logger;
  mode: "paper" | "live";
  intent: TradeIntent;
  walletPubkey?: string;
  baseAssetUsdPrice: number | null;
  pendingReservedEntryUsd?: number;
}

export interface RuntimeEntryRiskResult {
  ok: boolean;
  reason?: string;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
}

export async function checkRuntimeEntryRisk(ctx: RuntimeEntryRiskContext): Promise<RuntimeEntryRiskResult> {
  const { cfg, repos, jup, rpc, logger, mode, intent, walletPubkey, baseAssetUsdPrice, pendingReservedEntryUsd } = ctx;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const realizedPnlUsd = repos.realizedPnlUsdSince(dayStart.getTime());
  const unrealizedPnlUsd = await estimateUnrealizedPnlUsd({
    cfg,
    repos,
    jup,
    logger,
    baseAssetUsdPrice
  });
  const totalPnl = realizedPnlUsd + unrealizedPnlUsd;
  if (totalPnl <= -cfg.strategy.portfolio.maxDailyLossUsd) {
    return {
      ok: false,
      reason: `daily_loss_guard:${totalPnl.toFixed(2)} <= -${cfg.strategy.portfolio.maxDailyLossUsd}`,
      realizedPnlUsd,
      unrealizedPnlUsd
    };
  }

  if (mode === "live") {
    if (cfg.strategy.portfolio.maxLiveCapitalUsd > 0) {
      if (!baseAssetUsdPrice || baseAssetUsdPrice <= 0) {
        return {
          ok: false,
          reason: "capital_cap_guard:missing_base_price",
          realizedPnlUsd,
          unrealizedPnlUsd
        };
      }

      let deployedMicroUsd = 0n;
      for (const p of repos.getOpenPositions()) {
        deployedMicroUsd += lamportsToMicroUsd(p.entryBaseAmount, baseAssetUsdPrice);
      }
      const pendingMicroUsd = usdToMicro(Math.max(0, pendingReservedEntryUsd ?? 0));
      const intentMicroUsd = usdToMicro(Math.max(0, intent.notionalUsd));
      const projectedMicroUsd = deployedMicroUsd + pendingMicroUsd + intentMicroUsd;
      const capMicroUsd = usdToMicro(cfg.strategy.portfolio.maxLiveCapitalUsd);
      if (projectedMicroUsd > capMicroUsd) {
        return {
          ok: false,
          reason: `capital_cap_guard:${microToUsdString(projectedMicroUsd)}>${microToUsdString(capMicroUsd)}`,
          realizedPnlUsd,
          unrealizedPnlUsd
        };
      }
    }

    if (!walletPubkey) {
      return { ok: false, reason: "wallet_missing", realizedPnlUsd, unrealizedPnlUsd };
    }
    const balanceLamports = BigInt(await rpc.getBalance(walletPubkey));
    const reserve = BigInt(cfg.execution.walletReserveLamports);
    const feeEstimate = BigInt(cfg.execution.txFeeLamportsEstimate);
    const required = intent.amountIn + reserve + feeEstimate;
    if (balanceLamports < required) {
      return {
        ok: false,
        reason: `wallet_balance_guard:${balanceLamports.toString()}<${required.toString()}`,
        realizedPnlUsd,
        unrealizedPnlUsd
      };
    }
  }

  return { ok: true, realizedPnlUsd, unrealizedPnlUsd };
}

async function estimateUnrealizedPnlUsd(params: {
  cfg: AppConfig;
  repos: Repos;
  jup: JupiterUltraClient;
  logger: Logger;
  baseAssetUsdPrice: number | null;
}): Promise<number> {
  const { cfg, repos, jup, logger, baseAssetUsdPrice } = params;
  if (!baseAssetUsdPrice || baseAssetUsdPrice <= 0) return 0;

  let unrealized = 0;
  const positions = repos.getOpenPositions().slice(0, Math.max(1, cfg.strategy.portfolio.maxOpenPositions));
  for (const p of positions) {
    try {
      const inventory = p.currentTokenAmount > 0n ? p.currentTokenAmount : p.entryTokenAmount;
      let remainingBaseQuote = 0n;
      if (inventory > 0n) {
        const quote = await jup.getOrder({
          inputMint: p.mint,
          outputMint: cfg.assets.baseAssetMint,
          amount: inventory.toString(),
          slippageBps: cfg.execution.slippageBpsExit
        });
        remainingBaseQuote = BigInt(quote.outAmount);
      }
      const realizedPartialBase = p.exitBaseAmount ?? 0n;
      const openNetLamports = realizedPartialBase + remainingBaseQuote - p.entryBaseAmount;
      unrealized += microToUsdNumber(lamportsToMicroUsd(openNetLamports, baseAssetUsdPrice));
    } catch (err) {
      logger.debug({ mint: p.mint, err: String(err) }, "unrealized pnl quote failed");
    }
  }
  return unrealized;
}
