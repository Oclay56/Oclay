import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { computeExitSignal } from "../../src/strategy/stateMachine";

describe("state machine exits", () => {
  test("stop loss triggers", () => {
    const cfg = loadAppConfig("config/default.json");
    const pos: any = {
      id: "p1",
      mint: "m1",
      mode: "paper",
      status: "OPEN",
      openedAtMs: Date.now() - 5 * 60_000,
      baseMint: cfg.assets.baseAssetMint,
      entryBaseAmount: 1n,
      entryTokenAmount: 1n,
      entryPriceUsd: 1.0,
      maxSeenPriceUsd: 1.0
    };
    const now = Date.now();
    const currentPrice = 1.0 * (1 - cfg.strategy.exits.stopLossBps / 10_000) - 0.0001;
    const sig = computeExitSignal(cfg, pos, currentPrice, now);
    expect(sig.shouldExit).toBe(true);
    expect(sig.reason).toMatch(/stopLoss/);
  });

  test("trailing stop updates maxSeenPrice", () => {
    const cfg = loadAppConfig("config/default.json");
    const pos: any = {
      id: "p1",
      mint: "m1",
      mode: "paper",
      status: "OPEN",
      openedAtMs: Date.now() - 5 * 60_000,
      baseMint: cfg.assets.baseAssetMint,
      entryBaseAmount: 1n,
      entryTokenAmount: 1n,
      entryPriceUsd: 1.0,
      maxSeenPriceUsd: 1.05
    };
    const now = Date.now();
    const currentPrice = 1.08;
    const sig = computeExitSignal(cfg, pos, currentPrice, now);
    expect(sig.shouldExit).toBe(false);
    expect(sig.updatedMaxSeenPriceUsd).toBe(1.08);
  });

  test("does not emit TP signals once tpStep is already terminal", () => {
    const cfg = loadAppConfig("config/default.json");
    const pos: any = {
      id: "p2",
      mint: "m2",
      mode: "paper",
      status: "OPEN",
      openedAtMs: Date.now() - 2 * 60_000,
      baseMint: cfg.assets.baseAssetMint,
      entryBaseAmount: 1n,
      entryTokenAmount: 1n,
      initialTokenAmount: 1n,
      currentTokenAmount: 1n,
      tpStep: 3,
      entryPriceUsd: 1.0,
      maxSeenPriceUsd: 1.4
    };

    const sig = computeExitSignal(cfg, pos, 1.6, Date.now());
    expect(sig.shouldExit).toBe(false);
    expect(sig.exitKind).toBeUndefined();
    expect(sig.nextTpStep).toBeUndefined();
  });
});
