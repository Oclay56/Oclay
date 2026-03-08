import crypto from "node:crypto";
import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { TokenRiskReport, TradeIntent, TradeMode } from "../domain/types";
import type { Repos } from "../storage/repos";

export interface DecideContext {
  cfg: AppConfig;
  report: TokenRiskReport;
  mode: TradeMode;
  repos: Repos;
  logger: Logger;
  baseAssetUsdPrice: number | null;
}

export type EntryDecisionResult =
  | { ok: true; intent: TradeIntent }
  | { ok: false; rejectReason: string };

export function decideEntryIntent(ctx: DecideContext): EntryDecisionResult {
  const { cfg, report, repos, mode, logger, baseAssetUsdPrice } = ctx;
  const nowMs = Date.now();
  const reject = (rejectReason: string): EntryDecisionResult => ({ ok: false, rejectReason });

  // Hard rejects (fail closed)
  if (!report.canExitRoute) return reject("no_exit_route");
  if (cfg.analysis.rejectIfMintAuthority && report.flags.includes("HAS_MINT_AUTH")) return reject("flag_has_mint_auth");
  if (cfg.analysis.rejectIfFreezeAuthority && report.flags.includes("HAS_FREEZE_AUTH")) return reject("flag_has_freeze_auth");
  if (cfg.analysis.rejectIfToken2022TransferHook && report.flags.includes("TOKEN2022_TRANSFER_HOOK")) {
    return reject("flag_token2022_transfer_hook");
  }
  if (cfg.analysis.rejectIfToken2022NonTransferable && report.flags.includes("NON_TRANSFERABLE")) {
    return reject("flag_non_transferable");
  }
  if (cfg.analysis.rejectIfToken2022DefaultFrozen && report.flags.includes("DEFAULT_FROZEN")) {
    return reject("flag_default_frozen");
  }
  if (report.flags.includes("PROBE_FAILED")) return reject("flag_probe_failed");
  if (report.flags.includes("SUPPLY_INCREASED")) return reject("flag_supply_increased");
  if (report.flags.includes("LIQUIDITY_DRAIN")) return reject("flag_liquidity_drain");
  if (report.flags.includes("TOP10_TOO_CONCENTRATED")) return reject("flag_top10_too_concentrated");
  if (report.flags.includes("HOLDERS_UNKNOWN")) return reject("flag_holders_unknown");
  if (report.flags.includes("LOW_LIQUIDITY")) return reject("flag_low_liquidity");

  // Basic lifecycle filter
  if (report.marketAgeMinutes !== undefined && report.marketAgeMinutes < cfg.analysis.minMarketAgeMinutes) {
    return reject(`market_age_too_new:${report.marketAgeMinutes.toFixed(1)}<${cfg.analysis.minMarketAgeMinutes}`);
  }
  if (
    report.marketAgeMinutes !== undefined &&
    cfg.analysis.maxMarketAgeMinutes > 0 &&
    report.marketAgeMinutes > cfg.analysis.maxMarketAgeMinutes
  ) {
    return reject(`market_age_too_old:${report.marketAgeMinutes.toFixed(1)}>${cfg.analysis.maxMarketAgeMinutes}`);
  }

  if (repos.getOpenPositionByMint(report.mint)) return reject("open_position_exists");
  if (repos.countOpenPositions() >= cfg.strategy.portfolio.maxOpenPositions) {
    return reject(`open_position_cap:${repos.countOpenPositions()}>=${cfg.strategy.portfolio.maxOpenPositions}`);
  }

  // Daily loss guard (realized PnL only)
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const realized = repos.realizedPnlUsdSince(dayStart.getTime());
  if (realized <= -cfg.strategy.portfolio.maxDailyLossUsd) {
    logger.warn({ realized }, "daily loss limit hit; refusing new entries");
    return reject(`daily_loss_limit:${realized.toFixed(2)}<=-${cfg.strategy.portfolio.maxDailyLossUsd}`);
  }

  if (report.tradeScore < cfg.strategy.entryThreshold) {
    return reject(`trade_score_below_threshold:${report.tradeScore.toFixed(2)}<${cfg.strategy.entryThreshold}`);
  }

  // Edge-focused entry filters
  const edge = cfg.strategy.entry;
  const liquidityUsd = report.liquidityUsd ?? 0;
  if (liquidityUsd < edge.minLiquidityUsd) {
    return reject(`entry_liquidity_below_min:${liquidityUsd.toFixed(0)}<${edge.minLiquidityUsd}`);
  }

  const marketAgeMinutes = report.marketAgeMinutes;
  if (marketAgeMinutes === undefined) return reject("entry_market_age_missing");
  if (marketAgeMinutes > edge.maxMarketAgeMinutes) {
    return reject(`entry_market_age_too_old:${marketAgeMinutes.toFixed(1)}>${edge.maxMarketAgeMinutes}`);
  }

  const top1HolderPct = report.top1HolderPct;
  if (top1HolderPct === undefined) return reject("top1_holder_missing");
  if (top1HolderPct > edge.maxTop1HolderPct) {
    return reject(`top1_holder_too_high:${top1HolderPct.toFixed(2)}>${edge.maxTop1HolderPct}`);
  }

  const marketMetrics = asRecord((report.metrics as any)?.market);
  const volumeM5Usd = firstFiniteNumber(marketMetrics.volumeM5Usd);
  const volumeH1Usd = firstFiniteNumber(marketMetrics.volumeH1Usd);
  if (volumeM5Usd === undefined || volumeM5Usd < edge.minVolumeM5Usd) {
    return reject(`volume_m5_below_min:${(volumeM5Usd ?? 0).toFixed(0)}<${edge.minVolumeM5Usd}`);
  }
  if (volumeH1Usd === undefined || volumeH1Usd <= 0) return reject("volume_h1_missing_or_zero");
  const volumeSpikeRatio = (volumeM5Usd * 12) / volumeH1Usd;
  if (volumeSpikeRatio < edge.minVolumeSpikeRatioM5VsH1Avg) {
    return reject(`volume_spike_below_min:${volumeSpikeRatio.toFixed(2)}<${edge.minVolumeSpikeRatioM5VsH1Avg}`);
  }

  const buysM5 = firstFiniteNumber(marketMetrics.buysM5);
  const sellsM5 = firstFiniteNumber(marketMetrics.sellsM5);
  if (buysM5 === undefined || sellsM5 === undefined) return reject("buy_sell_ratio_missing");
  const buySellRatioM5 = (buysM5 + 1) / (sellsM5 + 1);
  if (buySellRatioM5 < edge.minBuySellRatioM5) {
    return reject(`buy_sell_ratio_below_min:${buySellRatioM5.toFixed(2)}<${edge.minBuySellRatioM5}`);
  }

  const currentPriceUsd = firstFiniteNumber(marketMetrics.priceUsd);
  let buyZoneSummary = "";
  if (edge.requirePullbackBounce) {
    if (currentPriceUsd === undefined || currentPriceUsd <= 0) return reject("pullback_price_missing");
    const buyZone = evaluatePullbackBounceZone({
      repos,
      mint: report.mint,
      nowMs,
      currentPriceUsd,
      pullbackLookbackMinutes: edge.pullbackLookbackMinutes,
      pullbackMinPct: edge.pullbackMinPct,
      pullbackMaxPct: edge.pullbackMaxPct,
      baseLookbackSnapshots: edge.baseLookbackSnapshots,
      baseMaxLowRangePct: edge.baseMaxLowRangePct,
      bounceMinReboundPct: edge.bounceMinReboundPct,
      requireVolumeConfirmation: edge.requireVolumeConfirmation,
      volumeConfirmLookbackSnapshots: edge.volumeConfirmLookbackSnapshots,
      volumeConfirmMultiplier: edge.volumeConfirmMultiplier
    });
    if (!buyZone.ok) return reject(`pullback_bounce_not_ready:${buyZone.reason}`);
    buyZoneSummary =
      `;pullback=${buyZone.pullbackPct.toFixed(2)}%` +
      `;baseRange=${buyZone.baseLowRangePct.toFixed(2)}%` +
      `;rebound=${buyZone.reboundPct.toFixed(2)}%` +
      `;volx=${buyZone.volumeRatio.toFixed(2)}x`;
  }

  let demandZoneSummary = "";
  if (edge.requireDemandZone) {
    if (currentPriceUsd === undefined || currentPriceUsd <= 0) return reject("demand_zone_price_missing");
    const demandZone = evaluateDemandZone({
      repos,
      mint: report.mint,
      nowMs,
      lookbackMinutes: edge.demandZoneLookbackMinutes,
      bandPct: edge.demandZoneBandPct,
      minSnapshots: edge.demandZoneMinSnapshots,
      currentPriceUsd
    });
    if (!demandZone.ok) return reject(`demand_zone_not_ready:${demandZone.reason}`);
    demandZoneSummary = `,demandCeil=${demandZone.demandCeil.toFixed(8)},demandLow=${demandZone.demandLow.toFixed(8)}`;
  }

  if (!baseAssetUsdPrice || baseAssetUsdPrice <= 0) {
    logger.debug("missing base asset USD price; skipping entry sizing");
    return reject("base_asset_price_missing");
  }

  const notionalUsd = cfg.strategy.sniper.enabled
    ? (cfg.strategy.portfolio.maxPositionNotionalUsd * cfg.strategy.sniper.initialEntryPct) / 100
    : cfg.strategy.portfolio.maxPositionNotionalUsd;
  const lamportsPerUnit = 1_000_000_000; // wSOL/SOL
  const amountInLamports = BigInt(Math.floor((notionalUsd / baseAssetUsdPrice) * lamportsPerUnit));
  if (amountInLamports <= 0n) return reject("entry_amount_zero");

  const intent: TradeIntent = {
    id: crypto.randomUUID(),
    type: "BUY",
    intentKind: cfg.strategy.sniper.enabled ? "ENTRY_TEST" : "ENTRY_SCALE",
    mode,
    mint: report.mint,
    baseMint: cfg.assets.baseAssetMint,
    notionalUsd,
    amountIn: amountInLamports,
    slippageBps: cfg.execution.slippageBpsEntry,
    createdAtMs: nowMs,
    reason:
      `tradeScore=${report.tradeScore.toFixed(2)}>=${cfg.strategy.entryThreshold}` +
      `;liq=${liquidityUsd.toFixed(0)}` +
      `;age=${marketAgeMinutes.toFixed(1)}m` +
      `;top1=${top1HolderPct.toFixed(2)}%` +
      `;m5=${volumeM5Usd.toFixed(0)}` +
      `;m5Spike=${volumeSpikeRatio.toFixed(2)}x` +
      `;buySellM5=${buySellRatioM5.toFixed(2)}` +
      `${buyZoneSummary}` +
      `${demandZoneSummary}`
  };

  return { ok: true, intent };
}

function evaluatePullbackBounceZone(params: {
  repos: Repos;
  mint: string;
  nowMs: number;
  currentPriceUsd: number;
  pullbackLookbackMinutes: number;
  pullbackMinPct: number;
  pullbackMaxPct: number;
  baseLookbackSnapshots: number;
  baseMaxLowRangePct: number;
  bounceMinReboundPct: number;
  requireVolumeConfirmation: boolean;
  volumeConfirmLookbackSnapshots: number;
  volumeConfirmMultiplier: number;
}): {
  ok: boolean;
  reason: string;
  pullbackPct: number;
  baseLowRangePct: number;
  reboundPct: number;
  volumeRatio: number;
} {
  const {
    repos,
    mint,
    nowMs,
    currentPriceUsd,
    pullbackLookbackMinutes,
    pullbackMinPct,
    pullbackMaxPct,
    baseLookbackSnapshots,
    baseMaxLowRangePct,
    bounceMinReboundPct,
    requireVolumeConfirmation,
    volumeConfirmLookbackSnapshots,
    volumeConfirmMultiplier
  } = params;
  const sinceMs = nowMs - Math.max(1, Math.floor(pullbackLookbackMinutes)) * 60_000;
  const snapshots = repos
    .getRecentSnapshotsByMint({ mint, sinceMs, limit: 300 })
    .sort((a, b) => a.capturedAtMs - b.capturedAtMs);

  const prices = snapshots
    .map((s) => s.priceUsd)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (prices.length < Math.max(3, Math.floor(baseLookbackSnapshots))) {
    return {
      ok: false,
      reason: `insufficient_price_snapshots:${prices.length}<${Math.max(3, Math.floor(baseLookbackSnapshots))}`,
      pullbackPct: 0,
      baseLowRangePct: 0,
      reboundPct: 0,
      volumeRatio: 0
    };
  }

  const recentHigh = Math.max(...prices);
  if (!Number.isFinite(recentHigh) || recentHigh <= 0) {
    return { ok: false, reason: "recent_high_invalid", pullbackPct: 0, baseLowRangePct: 0, reboundPct: 0, volumeRatio: 0 };
  }

  const pullbackPct = ((recentHigh - currentPriceUsd) / recentHigh) * 100;
  if (pullbackPct < pullbackMinPct || pullbackPct > pullbackMaxPct) {
    return {
      ok: false,
      reason: `pullback_out_of_band:${pullbackPct.toFixed(2)} not in ${pullbackMinPct}-${pullbackMaxPct}`,
      pullbackPct,
      baseLowRangePct: 0,
      reboundPct: 0,
      volumeRatio: 0
    };
  }

  const baseCount = Math.max(3, Math.floor(baseLookbackSnapshots));
  const basePrices = prices.slice(-baseCount);
  if (basePrices.length < baseCount) {
    return {
      ok: false,
      reason: `insufficient_base_prices:${basePrices.length}<${baseCount}`,
      pullbackPct,
      baseLowRangePct: 0,
      reboundPct: 0,
      volumeRatio: 0
    };
  }
  const baseLow = Math.min(...basePrices);
  const baseHigh = Math.max(...basePrices);
  const baseLowRangePct = baseLow > 0 ? ((baseHigh - baseLow) / baseLow) * 100 : 0;
  if (baseLowRangePct > baseMaxLowRangePct) {
    return {
      ok: false,
      reason: `base_range_too_wide:${baseLowRangePct.toFixed(2)}>${baseMaxLowRangePct}`,
      pullbackPct,
      baseLowRangePct,
      reboundPct: 0,
      volumeRatio: 0
    };
  }

  const prevPrice = basePrices[basePrices.length - 2];
  const reboundPct = baseLow > 0 ? ((currentPriceUsd - baseLow) / baseLow) * 100 : 0;
  const bounceConfirmed = currentPriceUsd > prevPrice && reboundPct >= bounceMinReboundPct;
  if (!bounceConfirmed) {
    return {
      ok: false,
      reason: `bounce_not_confirmed:rebound=${reboundPct.toFixed(2)} prev=${prevPrice.toFixed(8)}`,
      pullbackPct,
      baseLowRangePct,
      reboundPct,
      volumeRatio: 0
    };
  }

  let volumeRatio = 1;
  if (requireVolumeConfirmation) {
    const volumeSeries = snapshots
      .map((s) => s.volumeM5Usd)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
    const volWindow = Math.max(2, Math.floor(volumeConfirmLookbackSnapshots));
    if (volumeSeries.length < volWindow + 1) {
      return {
        ok: false,
        reason: `insufficient_volume_snapshots:${volumeSeries.length}<${volWindow + 1}`,
        pullbackPct,
        baseLowRangePct,
        reboundPct,
        volumeRatio: 0
      };
    }
    const currentVolume = volumeSeries[volumeSeries.length - 1];
    const priorWindow = volumeSeries.slice(-(volWindow + 1), -1);
    const avgVolume = average(priorWindow);
    if (!Number.isFinite(avgVolume) || avgVolume <= 0) {
      return {
        ok: false,
        reason: "avg_volume_invalid",
        pullbackPct,
        baseLowRangePct,
        reboundPct,
        volumeRatio: 0
      };
    }
    volumeRatio = currentVolume / avgVolume;
    if (volumeRatio < volumeConfirmMultiplier) {
      return {
        ok: false,
        reason: `volume_confirmation_failed:${volumeRatio.toFixed(2)}<${volumeConfirmMultiplier}`,
        pullbackPct,
        baseLowRangePct,
        reboundPct,
        volumeRatio
      };
    }
  }

  return { ok: true, reason: "ok", pullbackPct, baseLowRangePct, reboundPct, volumeRatio };
}

function evaluateDemandZone(params: {
  repos: Repos;
  mint: string;
  nowMs: number;
  lookbackMinutes: number;
  bandPct: number;
  minSnapshots: number;
  currentPriceUsd: number;
}): { ok: boolean; reason: string; demandLow: number; demandCeil: number } {
  const { repos, mint, nowMs, lookbackMinutes, bandPct, minSnapshots, currentPriceUsd } = params;
  const sinceMs = nowMs - Math.max(1, Math.floor(lookbackMinutes)) * 60_000;
  const snapshots = repos.getRecentSnapshotsByMint({ mint, sinceMs, limit: 240 });
  const prices = snapshots
    .map((s) => s.priceUsd)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);

  if (prices.length < Math.max(2, Math.floor(minSnapshots))) {
    return {
      ok: false,
      reason: `insufficient_demand_snapshots:${prices.length}<${Math.max(2, Math.floor(minSnapshots))}`,
      demandLow: NaN,
      demandCeil: NaN
    };
  }

  const demandLow = Math.min(...prices);
  const demandCeil = demandLow * (1 + Math.max(0, bandPct) / 100);
  return {
    ok: currentPriceUsd <= demandCeil,
    reason:
      currentPriceUsd <= demandCeil
        ? "ok"
        : `price_above_demand_band:${currentPriceUsd.toFixed(8)}>${demandCeil.toFixed(8)}`,
    demandLow,
    demandCeil
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}
