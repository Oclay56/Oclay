import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import {
  createEntryAdmissionState,
  releaseEntryAdmission,
  tryReserveEntryAdmission
} from "../../src/runtime/entryAdmission";
import type { TradeIntent } from "../../src/domain/types";

function buildIntent(cfg: ReturnType<typeof loadAppConfig>, overrides: Partial<TradeIntent> = {}): TradeIntent {
  return {
    id: overrides.id ?? "intent",
    type: "BUY",
    intentKind: "ENTRY_TEST",
    mode: "live",
    mint: overrides.mint ?? "mint",
    baseMint: cfg.assets.baseAssetMint,
    notionalUsd: overrides.notionalUsd ?? 12,
    amountIn: overrides.amountIn ?? 100_000_000n,
    slippageBps: overrides.slippageBps ?? 100,
    createdAtMs: overrides.createdAtMs ?? Date.now(),
    reason: overrides.reason ?? "test",
    positionId: overrides.positionId
  };
}

describe("runtime entry admission", () => {
  test("reserves open-position capacity synchronously across concurrent candidates", () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.strategy.portfolio.maxOpenPositions = 1;
    const state = createEntryAdmissionState();
    const repos: any = {
      getOpenPositionByMint: () => null,
      countOpenPositions: () => 0,
      getOpenPositions: () => []
    };

    const first = tryReserveEntryAdmission({
      state,
      cfg,
      repos,
      mode: "live",
      intent: buildIntent(cfg, { mint: "mint-a" }),
      baseAssetUsdPrice: 100
    });
    const second = tryReserveEntryAdmission({
      state,
      cfg,
      repos,
      mode: "live",
      intent: buildIntent(cfg, { mint: "mint-b", id: "intent-2" }),
      baseAssetUsdPrice: 100
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/entry_reservation_open_cap/);
  });

  test("reserves live capital before the next candidate is admitted", () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.strategy.portfolio.maxLiveCapitalUsd = 20;
    const state = createEntryAdmissionState();
    const repos: any = {
      getOpenPositionByMint: () => null,
      countOpenPositions: () => 0,
      getOpenPositions: () => []
    };

    const first = tryReserveEntryAdmission({
      state,
      cfg,
      repos,
      mode: "live",
      intent: buildIntent(cfg, { mint: "mint-a", notionalUsd: 12 }),
      baseAssetUsdPrice: 100
    });
    const second = tryReserveEntryAdmission({
      state,
      cfg,
      repos,
      mode: "live",
      intent: buildIntent(cfg, { mint: "mint-b", id: "intent-2", notionalUsd: 12 }),
      baseAssetUsdPrice: 100
    });

    expect(first.ok).toBe(true);
    expect(state.reservedLiveEntryUsd).toBe(12);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/entry_reservation_capital_cap/);
  });

  test("scale reservations can reserve capital without consuming a position slot", () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.strategy.portfolio.maxOpenPositions = 1;
    cfg.strategy.portfolio.maxLiveCapitalUsd = 20;
    const state = createEntryAdmissionState();
    const repos: any = {
      getOpenPositionByMint: () => ({
        id: "p1"
      }),
      countOpenPositions: () => 1,
      getOpenPositions: () => [
        {
          entryBaseAmount: 0n
        }
      ]
    };

    const res = tryReserveEntryAdmission({
      state,
      cfg,
      repos,
      mode: "live",
      intent: buildIntent(cfg, { mint: "mint-a", notionalUsd: 8 }),
      baseAssetUsdPrice: 100,
      reserveMint: false,
      reservePositionSlot: false
    });

    expect(res.ok).toBe(true);
    expect(res.reservedSlot).toBe(false);
    expect(state.reservedPositionSlots).toBe(0);
    expect(state.reservedLiveEntryUsd).toBe(8);

    releaseEntryAdmission({
      state,
      mint: "mint-a",
      reservedUsd: res.reservedUsd,
      reservedMint: res.reservedMint,
      reservedSlot: res.reservedSlot
    });
    expect(state.reservedLiveEntryUsd).toBe(0);
  });
});
