import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { decideSniperScale } from "../../src/strategy/sniperStateMachine";

describe("sniper state machine", () => {
  test("scales after delay when route/liquidity checks are healthy", () => {
    const cfg = loadAppConfig("config/default.json");
    const now = Date.now();
    const decision = decideSniperScale({
      cfg,
      position: {
        id: "p1",
        mint: "mint",
        mode: "paper",
        status: "OPEN",
        stage: "TEST",
        sniperMode: true,
        tpStep: 0,
        openedAtMs: now - cfg.strategy.sniper.scaleDelayMs - 1_000,
        baseMint: cfg.assets.baseAssetMint,
        entryBaseAmount: 1n,
        entryTokenAmount: 1n,
        initialTokenAmount: 1n,
        currentTokenAmount: 1n
      },
      nowMs: now,
      routeHealthy: true,
      liquidityDegradePct: 2,
      hasCriticalFlags: false,
      stageBStatus: "clean"
    });
    expect(decision.shouldScale).toBe(true);
    expect(decision.amountPct).toBe(cfg.strategy.sniper.scaleEntryPct);
  });

  test("blocks scale when route is unhealthy", () => {
    const cfg = loadAppConfig("config/default.json");
    const now = Date.now();
    const decision = decideSniperScale({
      cfg,
      position: {
        id: "p2",
        mint: "mint",
        mode: "paper",
        status: "OPEN",
        stage: "TEST",
        sniperMode: true,
        tpStep: 0,
        openedAtMs: now - cfg.strategy.sniper.scaleDelayMs - 1_000,
        baseMint: cfg.assets.baseAssetMint,
        entryBaseAmount: 1n,
        entryTokenAmount: 1n,
        initialTokenAmount: 1n,
        currentTokenAmount: 1n
      },
      nowMs: now,
      routeHealthy: false,
      liquidityDegradePct: 0,
      hasCriticalFlags: false,
      stageBStatus: "clean"
    });
    expect(decision.shouldScale).toBe(false);
    expect(decision.reason).toMatch(/route/i);
  });

  test("blocks scale when stage B is not complete", () => {
    const cfg = loadAppConfig("config/default.json");
    const now = Date.now();
    const decision = decideSniperScale({
      cfg,
      position: {
        id: "p3",
        mint: "mint",
        mode: "paper",
        status: "OPEN",
        stage: "TEST",
        sniperMode: true,
        tpStep: 0,
        openedAtMs: now - cfg.strategy.sniper.scaleDelayMs - 1_000,
        baseMint: cfg.assets.baseAssetMint,
        entryBaseAmount: 1n,
        entryTokenAmount: 1n,
        initialTokenAmount: 1n,
        currentTokenAmount: 1n
      },
      nowMs: now,
      routeHealthy: true,
      liquidityDegradePct: 0,
      hasCriticalFlags: false,
      stageBStatus: "pending"
    });
    expect(decision.shouldScale).toBe(false);
    expect(decision.reason).toContain("stageb_gate");
  });
});
