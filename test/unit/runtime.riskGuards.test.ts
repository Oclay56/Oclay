import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { checkRuntimeEntryRisk } from "../../src/strategy/riskGuards";
import type { TradeIntent } from "../../src/domain/types";

describe("runtime risk guards", () => {
  test("blocks live entry when wallet balance is below reserve threshold", async () => {
    const cfg = loadAppConfig("config/default.json");
    const repos: any = {
      realizedPnlUsdSince: () => 0,
      getOpenPositions: () => []
    };
    const rpc: any = {
      getBalance: async () => 10
    };
    const jup: any = {
      getOrder: async () => {
        throw new Error("unused");
      }
    };
    const intent: TradeIntent = {
      id: "i1",
      type: "BUY",
      intentKind: "ENTRY_TEST",
      mode: "live",
      mint: "mint",
      baseMint: cfg.assets.baseAssetMint,
      notionalUsd: 1,
      amountIn: 1_000n,
      slippageBps: 100,
      createdAtMs: Date.now(),
      reason: "test"
    };
    const logger: any = { debug: () => undefined, warn: () => undefined };

    const res = await checkRuntimeEntryRisk({
      cfg,
      repos,
      jup,
      rpc,
      logger,
      mode: "live",
      intent,
      walletPubkey: "wallet",
      baseAssetUsdPrice: 100
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/wallet_balance_guard/);
  });

  test("blocks entry when realized+unrealized daily loss exceeds max", async () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.strategy.portfolio.maxDailyLossUsd = 3;
    const repos: any = {
      realizedPnlUsdSince: () => -2,
      getOpenPositions: () => [
        {
          id: "p1",
          mint: "mint",
          mode: "paper",
          status: "OPEN",
          stage: "FULL",
          sniperMode: false,
          tpStep: 0,
          openedAtMs: Date.now(),
          baseMint: cfg.assets.baseAssetMint,
          entryBaseAmount: 1_000_000_000n,
          entryTokenAmount: 100n,
          initialTokenAmount: 100n,
          currentTokenAmount: 100n
        }
      ]
    };
    const rpc: any = { getBalance: async () => 1_000_000_000 };
    const jup: any = {
      getOrder: async () => ({
        outAmount: "900000000"
      })
    };
    const intent: TradeIntent = {
      id: "i2",
      type: "BUY",
      intentKind: "ENTRY_TEST",
      mode: "paper",
      mint: "mint2",
      baseMint: cfg.assets.baseAssetMint,
      notionalUsd: 1,
      amountIn: 1_000n,
      slippageBps: 100,
      createdAtMs: Date.now(),
      reason: "test"
    };
    const logger: any = { debug: () => undefined, warn: () => undefined };

    const res = await checkRuntimeEntryRisk({
      cfg,
      repos,
      jup,
      rpc,
      logger,
      mode: "paper",
      intent,
      baseAssetUsdPrice: 100
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/daily_loss_guard/);
  });

  test("blocks live entry when projected deployed capital exceeds maxLiveCapitalUsd", async () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.strategy.portfolio.maxLiveCapitalUsd = 40;
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
          entryBaseAmount: 1_000_000_000n,
          entryTokenAmount: 100n,
          initialTokenAmount: 100n,
          currentTokenAmount: 100n
        }
      ]
    };
    const rpc: any = { getBalance: async () => 10_000_000_000 };
    const jup: any = { getOrder: async () => ({ outAmount: "1000000000" }) };
    const logger: any = { debug: () => undefined, warn: () => undefined };
    const intent: TradeIntent = {
      id: "i3",
      type: "BUY",
      intentKind: "ENTRY_TEST",
      mode: "live",
      mint: "mintB",
      baseMint: cfg.assets.baseAssetMint,
      notionalUsd: 12,
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
      baseAssetUsdPrice: 30,
      pendingReservedEntryUsd: 2
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/capital_cap_guard/);
  });

  test("passes live capital cap when projected capital is within limit", async () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.strategy.portfolio.maxLiveCapitalUsd = 40;
    const repos: any = {
      realizedPnlUsdSince: () => 0,
      getOpenPositions: () => []
    };
    const rpc: any = { getBalance: async () => 10_000_000_000 };
    const jup: any = { getOrder: async () => ({ outAmount: "1000000000" }) };
    const logger: any = { debug: () => undefined, warn: () => undefined };
    const intent: TradeIntent = {
      id: "i4",
      type: "BUY",
      intentKind: "ENTRY_TEST",
      mode: "live",
      mint: "mintB",
      baseMint: cfg.assets.baseAssetMint,
      notionalUsd: 12,
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
      baseAssetUsdPrice: 30,
      pendingReservedEntryUsd: 5
    });
    expect(res.ok).toBe(true);
  });

  test("treats open position PnL as partial realized plus remaining MTM", async () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.strategy.portfolio.maxDailyLossUsd = 5;
    const seenAmounts: string[] = [];
    const repos: any = {
      realizedPnlUsdSince: () => -2,
      getOpenPositions: () => [
        {
          id: "p-open",
          mint: "mint-open",
          mode: "paper",
          status: "OPEN",
          stage: "SCALED",
          sniperMode: true,
          tpStep: 1,
          openedAtMs: Date.now(),
          baseMint: cfg.assets.baseAssetMint,
          entryBaseAmount: 1_000_000_000n,
          entryTokenAmount: 100n,
          initialTokenAmount: 100n,
          currentTokenAmount: 40n,
          exitBaseAmount: 700_000_000n
        }
      ]
    };
    const rpc: any = { getBalance: async () => 1_000_000_000 };
    const jup: any = {
      getOrder: async (req: any) => {
        seenAmounts.push(String(req.amount));
        return { outAmount: "400000000" };
      }
    };
    const intent: TradeIntent = {
      id: "i-open-net",
      type: "BUY",
      intentKind: "ENTRY_TEST",
      mode: "paper",
      mint: "mint-next",
      baseMint: cfg.assets.baseAssetMint,
      notionalUsd: 1,
      amountIn: 1_000n,
      slippageBps: 100,
      createdAtMs: Date.now(),
      reason: "test"
    };
    const logger: any = { debug: () => undefined, warn: () => undefined };

    const res = await checkRuntimeEntryRisk({
      cfg,
      repos,
      jup,
      rpc,
      logger,
      mode: "paper",
      intent,
      baseAssetUsdPrice: 100
    });

    expect(seenAmounts[0]).toBe("40");
    expect(res.ok).toBe(true);
  });

  test("unrealized quote uses currentTokenAmount before entryTokenAmount", async () => {
    const cfg = loadAppConfig("config/default.json");
    const repos: any = {
      realizedPnlUsdSince: () => 0,
      getOpenPositions: () => [
        {
          id: "p1",
          mint: "mintA",
          mode: "paper",
          status: "OPEN",
          stage: "FULL",
          sniperMode: false,
          tpStep: 0,
          openedAtMs: Date.now(),
          baseMint: cfg.assets.baseAssetMint,
          entryBaseAmount: 1_000_000_000n,
          entryTokenAmount: 100n,
          initialTokenAmount: 100n,
          currentTokenAmount: 40n
        }
      ]
    };
    const rpc: any = { getBalance: async () => 1_000_000_000 };
    const seenAmounts: string[] = [];
    const jup: any = {
      getOrder: async (req: any) => {
        seenAmounts.push(String(req.amount));
        return { outAmount: "1000000000" };
      }
    };
    const logger: any = { debug: () => undefined, warn: () => undefined };
    const intent: TradeIntent = {
      id: "i5",
      type: "BUY",
      intentKind: "ENTRY_TEST",
      mode: "paper",
      mint: "mintB",
      baseMint: cfg.assets.baseAssetMint,
      notionalUsd: 1,
      amountIn: 1_000n,
      slippageBps: 100,
      createdAtMs: Date.now(),
      reason: "test"
    };

    await checkRuntimeEntryRisk({
      cfg,
      repos,
      jup,
      rpc,
      logger,
      mode: "paper",
      intent,
      baseAssetUsdPrice: 100
    });
    expect(seenAmounts[0]).toBe("40");
  });
});
