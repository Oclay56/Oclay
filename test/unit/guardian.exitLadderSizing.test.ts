import { describe, expect, test } from "vitest";
import { computeGuardianSellAmount } from "../../src/guardian/guardianLoop";

describe("guardian tp ladder sizing", () => {
  test("computes TP2 from initial-size cumulative target", () => {
    const amount = computeGuardianSellAmount({
      availableAmount: 700n,
      currentTrackedAmount: 700n,
      initialAmount: 1000n,
      exitKind: "TP2",
      ladderPercents: [30, 30, 40]
    });
    expect(amount).toBe(300n);
  });

  test("TP3 force-closes remaining available amount", () => {
    const amount = computeGuardianSellAmount({
      availableAmount: 245n,
      currentTrackedAmount: 245n,
      initialAmount: 1000n,
      exitKind: "TP3",
      ladderPercents: [30, 30, 40]
    });
    expect(amount).toBe(245n);
  });

  test("falls back to sellPct math for non-TP exits", () => {
    const amount = computeGuardianSellAmount({
      availableAmount: 1000n,
      currentTrackedAmount: 1000n,
      initialAmount: 1000n,
      sellPct: 25,
      exitKind: "STOP"
    });
    expect(amount).toBe(250n);
  });
});
