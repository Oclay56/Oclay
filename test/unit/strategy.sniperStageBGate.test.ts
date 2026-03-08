import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { decideSniperScale } from "../../src/strategy/sniperStateMachine";

describe("sniper stage-B gate", () => {
  const cfg = loadAppConfig("config/default.json");
  const now = Date.now();
  const basePosition = {
    id: "p1",
    mint: "mint",
    mode: "paper" as const,
    status: "OPEN" as const,
    stage: "TEST" as const,
    sniperMode: true,
    tpStep: 0,
    openedAtMs: now - cfg.strategy.sniper.scaleDelayMs - 1_000,
    baseMint: cfg.assets.baseAssetMint,
    entryBaseAmount: 1n,
    entryTokenAmount: 1n,
    initialTokenAmount: 1n,
    currentTokenAmount: 1n
  };

  test("blocks scale while stage-B is pending", () => {
    const decision = decideSniperScale({
      cfg,
      position: basePosition,
      nowMs: now,
      routeHealthy: true,
      liquidityDegradePct: 0,
      hasCriticalFlags: false,
      stageBStatus: "pending"
    });
    expect(decision.shouldScale).toBe(false);
  });

  test("blocks scale when stage-B is critical", () => {
    const decision = decideSniperScale({
      cfg,
      position: basePosition,
      nowMs: now,
      routeHealthy: true,
      liquidityDegradePct: 0,
      hasCriticalFlags: true,
      stageBStatus: "critical"
    });
    expect(decision.shouldScale).toBe(false);
  });

  test("allows scale only when stage-B is clean and route/liquidity pass", () => {
    const decision = decideSniperScale({
      cfg,
      position: basePosition,
      nowMs: now,
      routeHealthy: true,
      liquidityDegradePct: 1,
      hasCriticalFlags: false,
      stageBStatus: "clean"
    });
    expect(decision.shouldScale).toBe(true);
  });
});
