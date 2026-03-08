import type { AppConfig } from "../config/schema";
import type { TradeIntent, TradeMode } from "../domain/types";
import type { Repos } from "../storage/repos";
import { lamportsToUsdNumber } from "../utils/fixedPoint";

export interface EntryAdmissionState {
  reservedMints: Set<string>;
  reservedPositionSlots: number;
  reservedLiveEntryUsd: number;
}

export interface EntryAdmissionResult {
  ok: boolean;
  reason?: string;
  reservedUsd: number;
  reservedMint: boolean;
  reservedSlot: boolean;
}

export function createEntryAdmissionState(): EntryAdmissionState {
  return {
    reservedMints: new Set<string>(),
    reservedPositionSlots: 0,
    reservedLiveEntryUsd: 0
  };
}

export function resetEntryAdmissionState(state: EntryAdmissionState): void {
  state.reservedMints.clear();
  state.reservedPositionSlots = 0;
  state.reservedLiveEntryUsd = 0;
}

export function tryReserveEntryAdmission(params: {
  state: EntryAdmissionState;
  cfg: AppConfig;
  repos: Repos;
  mode: TradeMode;
  intent: TradeIntent;
  baseAssetUsdPrice: number | null;
  reserveMint?: boolean;
  reservePositionSlot?: boolean;
}): EntryAdmissionResult {
  const {
    state,
    cfg,
    repos,
    mode,
    intent,
    baseAssetUsdPrice,
    reserveMint = true,
    reservePositionSlot = true
  } = params;
  if (intent.type !== "BUY") {
    return { ok: false, reason: "entry_reservation_non_buy", reservedUsd: 0, reservedMint: false, reservedSlot: false };
  }
  if (reserveMint && (repos.getOpenPositionByMint(intent.mint) || state.reservedMints.has(intent.mint))) {
    return { ok: false, reason: "entry_reservation_mint_active", reservedUsd: 0, reservedMint: false, reservedSlot: false };
  }

  if (reservePositionSlot) {
    const projectedOpenPositions = repos.countOpenPositions() + state.reservedPositionSlots + 1;
    if (projectedOpenPositions > cfg.strategy.portfolio.maxOpenPositions) {
      return {
        ok: false,
        reason: `entry_reservation_open_cap:${projectedOpenPositions}>${cfg.strategy.portfolio.maxOpenPositions}`,
        reservedUsd: 0,
        reservedMint: false,
        reservedSlot: false
      };
    }
  }

  const reservedUsd = mode === "live" ? Math.max(0, intent.notionalUsd) : 0;
  if (mode === "live" && reservedUsd > 0 && cfg.strategy.portfolio.maxLiveCapitalUsd > 0) {
    if (!baseAssetUsdPrice || baseAssetUsdPrice <= 0) {
      return {
        ok: false,
        reason: "entry_reservation_missing_base_price",
        reservedUsd: 0,
        reservedMint: false,
        reservedSlot: false
      };
    }
    let deployedUsd = 0;
    for (const p of repos.getOpenPositions()) {
      deployedUsd += lamportsToUsdNumber(p.entryBaseAmount, baseAssetUsdPrice);
    }
    const projectedUsd = deployedUsd + state.reservedLiveEntryUsd + reservedUsd;
    if (projectedUsd > cfg.strategy.portfolio.maxLiveCapitalUsd) {
      return {
        ok: false,
        reason: `entry_reservation_capital_cap:${projectedUsd.toFixed(2)}>${cfg.strategy.portfolio.maxLiveCapitalUsd}`,
        reservedUsd: 0,
        reservedMint: false,
        reservedSlot: false
      };
    }
  }

  if (reserveMint) state.reservedMints.add(intent.mint);
  if (reservePositionSlot) state.reservedPositionSlots += 1;
  state.reservedLiveEntryUsd += reservedUsd;
  return {
    ok: true,
    reservedUsd,
    reservedMint: reserveMint,
    reservedSlot: reservePositionSlot
  };
}

export function releaseEntryAdmission(params: {
  state: EntryAdmissionState;
  mint: string;
  reservedUsd: number;
  reservedMint: boolean;
  reservedSlot: boolean;
}): void {
  const { state, mint, reservedUsd, reservedMint, reservedSlot } = params;
  if (reservedMint) state.reservedMints.delete(mint);
  if (reservedSlot) state.reservedPositionSlots = Math.max(0, state.reservedPositionSlots - 1);
  state.reservedLiveEntryUsd = Math.max(0, state.reservedLiveEntryUsd - Math.max(0, reservedUsd));
}
