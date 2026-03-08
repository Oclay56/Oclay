import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { computeOpportunityScore, computeRiskScore } from "../../src/strategy/score";

describe("scoring", () => {
  test("risk score sums weights and clamps", () => {
    const cfg = loadAppConfig("config/default.json");
    const score = computeRiskScore(cfg, ["HAS_FREEZE_AUTH", "HAS_MINT_AUTH"]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test("opportunity score is deterministic", () => {
    const cfg = loadAppConfig("config/default.json");
    const pair = {
      chainId: "solana",
      dexId: "raydium",
      url: "x",
      pairAddress: "y",
      baseToken: { address: "a", symbol: "AAA", name: "AAA" },
      quoteToken: { address: "b", symbol: "BBB", name: "BBB" },
      liquidityUsd: 100_000,
      volume: { m5: 500, h1: 1000, h24: 50_000 },
      txns: { m5: { buys: 50, sells: 10 } },
      priceChange: { m5: 5 }
    };
    const s1 = computeOpportunityScore(cfg, pair as any);
    const s2 = computeOpportunityScore(cfg, pair as any);
    expect(s1).toBe(s2);
    expect(s1).toBeGreaterThan(0);
  });
});

