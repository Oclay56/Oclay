import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { createSell429Breaker, isJupiterRateLimitError } from "../../src/execution/sell429Breaker";

describe("sell429 breaker", () => {
  test("first 429 applies base mint cooldown", () => {
    const cfg = loadAppConfig("config/default.json").execution.sell429;
    const breaker = createSell429Breaker(cfg, () => 0.5);
    const now = 1_000_000;
    const rec = breaker.recordSell429("mintA", now);
    expect(rec.mintRetryAtMs).toBe(now + cfg.perMintBaseCooldownMs);
    expect(rec.globalRetryAtMs).toBeUndefined();
    const defer = breaker.shouldDeferSell("mintA", now + 1);
    expect(defer.defer).toBe(true);
    expect(defer.reason).toBe("sell_429_mint_cooldown");
  });

  test("repeated 429 increases cooldown and caps at max", () => {
    const cfg = {
      perMintBaseCooldownMs: 10,
      perMintMaxCooldownMs: 25,
      backoffFactor: 2,
      jitterPct: 0,
      globalWindowMs: 1_000,
      globalTripCount: 99,
      globalCooldownMs: 100
    };
    const breaker = createSell429Breaker(cfg, () => 0.5);
    const now = 2_000_000;
    const a = breaker.recordSell429("mintA", now);
    const b = breaker.recordSell429("mintA", now + 1);
    const c = breaker.recordSell429("mintA", now + 2);
    expect(a.mintRetryAtMs - now).toBe(10);
    expect(b.mintRetryAtMs - (now + 1)).toBe(20);
    expect(c.mintRetryAtMs - (now + 2)).toBe(25);
  });

  test("global cooldown trips after threshold in window", () => {
    const cfg = loadAppConfig("config/default.json").execution.sell429;
    const breaker = createSell429Breaker(cfg, () => 0.5);
    const now = 3_000_000;
    breaker.recordSell429("mintA", now);
    breaker.recordSell429("mintB", now + 10);
    const third = breaker.recordSell429("mintC", now + 20);
    expect(third.globalRetryAtMs).toBe(now + 20 + cfg.globalCooldownMs);
    const defer = breaker.shouldDeferSell("mintZ", now + 25);
    expect(defer.defer).toBe(true);
    expect(defer.reason).toBe("sell_429_global_cooldown");
  });

  test("success clears mint streak", () => {
    const cfg = loadAppConfig("config/default.json").execution.sell429;
    const breaker = createSell429Breaker(cfg, () => 0.5);
    const now = 4_000_000;
    breaker.recordSell429("mintA", now);
    breaker.recordSell429("mintA", now + 1);
    breaker.recordSellSuccess("mintA");
    const rec = breaker.recordSell429("mintA", now + 2);
    expect(rec.mintRetryAtMs).toBe(now + 2 + cfg.perMintBaseCooldownMs);
  });

  test("snapshot exposes active global and per-mint cooldowns", () => {
    const cfg = loadAppConfig("config/default.json").execution.sell429;
    const breaker = createSell429Breaker(cfg, () => 0.5);
    const now = 5_000_000;
    breaker.recordSell429("mintA", now);
    breaker.recordSell429("mintB", now + 1);
    breaker.recordSell429("mintC", now + 2); // trips global
    const snap = breaker.getSnapshot(now + 3);
    expect(snap.globalCooldownUntilMs).toBeDefined();
    expect(snap.perMint.length).toBeGreaterThanOrEqual(3);
    expect(snap.perMint[0]?.mint).toBe("mintC");
  });

  test("rate-limit classifier is strict to Jupiter-like errors", () => {
    expect(isJupiterRateLimitError("Error: Jupiter Ultra order failed: 429 Rate limit exceeded")).toBe(true);
    expect(isJupiterRateLimitError("429 from unrelated upstream")).toBe(false);
  });
});
