import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";

describe("config", () => {
  test("default config parses", () => {
    const cfg = loadAppConfig("config/default.json");
    expect(cfg.assets.baseAssetMint).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(cfg.discovery.pollIntervalMs).toBeGreaterThan(0);
    expect(cfg.strategy.weights).toBeTruthy();
    expect(cfg.strategy.weights.HAS_FREEZE_AUTH).toBeTypeOf("number");
    expect(cfg.execution.sellAmountBufferBps).toBeGreaterThanOrEqual(0);
    expect(cfg.analysis.holders.rateLimitCooldownMs).toBeGreaterThan(0);
    expect(cfg.probe.requiredInLive).toBe(true);
    expect(cfg.paper.model).toBe("conservative");
    expect(cfg.strategy.portfolio.maxLiveCapitalUsd).toBeGreaterThanOrEqual(0);
    expect(cfg.execution.sell429.perMintBaseCooldownMs).toBeGreaterThan(0);
    expect(cfg.execution.sell429.globalTripCount).toBeGreaterThan(0);
    expect(cfg.discovery.stream.provider).toBe("helius_ws");
    expect(cfg.discovery.stream.parseMode).toBe("hybrid_strict");
    expect(cfg.discovery.stream.minCandidateConfidence).toBeGreaterThanOrEqual(0.7);
    expect(cfg.discovery.stream.decoderStrictMode).toBe(true);
    expect(cfg.discovery.stream.decoderFallbackConfidenceFloor).toBeGreaterThanOrEqual(0.8);
    expect(cfg.strategy.sniper.initialEntryPct).toBe(25);
    expect(cfg.strategy.sniper.requireStageBForScale).toBe(true);
    expect(cfg.strategy.exits.tpLadderPercents).toEqual([30, 30, 40]);
    expect(cfg.execution.router.entryMode).toBe("raydium_first");
    expect(cfg.execution.router.raydium.directEntryEnabled).toBe(false);
    expect(cfg.execution.router.raydium.poolKindPriority).toEqual(["cpmm"]);
    expect(cfg.telemetry.enabled).toBe(true);
    expect(cfg.telemetry.latencyKeyModel).toBe("candidate_intent_position");
  });

  test("live-40 config parses with hard cap disabled", () => {
    const cfg = loadAppConfig("config/live-40.json");
    expect(cfg.strategy.portfolio.maxLiveCapitalUsd).toBe(0);
    expect(cfg.strategy.portfolio.maxOpenPositions).toBe(1);
    expect(cfg.strategy.portfolio.maxPositionNotionalUsd).toBe(12);
    expect(cfg.execution.walletReserveLamports).toBe(50_000_000);
  });

  test("scam-scalp config parses with locked ultra guard-rail values", () => {
    const cfg = loadAppConfig("config/scam-scalp.json");
    expect(cfg.strategy.portfolio.maxOpenPositions).toBe(1);
    expect(cfg.strategy.portfolio.maxPositionNotionalUsd).toBe(6.5);
    expect(cfg.strategy.portfolio.maxDailyLossUsd).toBe(3);
    expect(cfg.strategy.portfolio.maxLiveCapitalUsd).toBe(0);
    expect(cfg.strategy.sniper.maxLiquidityDegradePctBeforeScale).toBe(5);
    expect(cfg.execution.sell429.globalTripCount).toBe(2);
    expect(cfg.analysis.holders.maxTop10Pct).toBe(24);
  });

  test("growth config parses with higher-upside profile values", () => {
    const cfg = loadAppConfig("config/growth.json");
    expect(cfg.strategy.portfolio.maxOpenPositions).toBe(2);
    expect(cfg.strategy.portfolio.maxPositionNotionalUsd).toBe(9.5);
    expect(cfg.strategy.portfolio.maxDailyLossUsd).toBe(4);
    expect(cfg.strategy.portfolio.maxLiveCapitalUsd).toBe(0);
    expect(cfg.strategy.sniper.maxHoldMinutes).toBe(8);
    expect(cfg.execution.maxRetries).toBe(2);
    expect(cfg.execution.sell429.globalTripCount).toBe(2);
    expect(cfg.analysis.holders.maxTop10Pct).toBe(28);
  });
});
