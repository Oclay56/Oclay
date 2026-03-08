import { describe, expect, test } from "vitest";
import { lamportsToUsdNumber, microToUsdNumber } from "../../src/utils/fixedPoint";

describe("fixed-point conversions", () => {
  test("converts large lamports values to USD without bigint Number casting path", () => {
    const usd = lamportsToUsdNumber(50_000_000_000_000_000n, 150);
    expect(Number.isFinite(usd)).toBe(true);
    expect(usd).toBeCloseTo(7_500_000_000, 3);
  });

  test("microToUsdNumber handles large micro values", () => {
    const usd = microToUsdNumber(123_456_789_012_345_678_901_234n);
    expect(Number.isFinite(usd)).toBe(true);
    expect(usd).toBeGreaterThan(0);
  });
});
