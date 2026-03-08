import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { checkRuntimeEntryRisk } from "../../src/strategy/riskGuards";

describe("risk guards fixed-point live capital", () => {
  test("handles large lamport balances without Number(BigInt) precision loss", async () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.strategy.portfolio.maxLiveCapitalUsd = 1_000_000_000;
    cfg.strategy.portfolio.maxDailyLossUsd = 9_000_000_000;
    const repos: any = {
      realizedPnlUsdSince: () => 0,
      getOpenPositions: () => [
        {
          id: "p1",
          mint: "mintA",
          mode: "live",
          status: "OPEN",
          stage: "FULL",
          sniperMode: false,
          tpStep: 0,
          openedAtMs: Date.now(),
          baseMint: cfg.assets.baseAssetMint,
          entryBaseAmount: 50_000_000_000_000_000n,
          entryTokenAmount: 1n,
          initialTokenAmount: 1n,
          currentTokenAmount: 1n
        }
      ]
    };
    const rpc: any = { getBalance: async () => 10_000_000_000 };
    const jup: any = { getOrder: async () => ({ outAmount: "50000000000000000" }) };
    const logger: any = { debug: () => undefined, warn: () => undefined };
    const intent: any = {
      id: "i-large",
      type: "BUY",
      intentKind: "ENTRY_TEST",
      mode: "live",
      mint: "mintB",
      baseMint: cfg.assets.baseAssetMint,
      notionalUsd: 1,
      amountIn: 100_000_000n,
      slippageBps: 100,
      createdAtMs: Date.now(),
      reason: "test"
    };

    const res = await checkRuntimeEntryRisk({
      cfg,
      repos,
      jup,
      rpc,
      logger,
      mode: "live",
      intent,
      walletPubkey: "wallet",
      baseAssetUsdPrice: 150,
      pendingReservedEntryUsd: 0
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("capital_cap_guard");
  });
});
