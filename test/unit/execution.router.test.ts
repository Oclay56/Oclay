import { beforeEach, describe, expect, test, vi } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { executeRoutedLiveBuy } from "../../src/execution/router";

const executeLiveBuyMock = vi.fn();
const executeRaydiumDirectBuyMock = vi.fn();

vi.mock("../../src/execution/swap", () => ({
  executeLiveBuy: (...args: any[]) => executeLiveBuyMock(...args)
}));

vi.mock("../../src/execution/raydiumSwap", () => ({
  executeRaydiumDirectBuy: (...args: any[]) => executeRaydiumDirectBuyMock(...args)
}));

describe("execution router", () => {
  beforeEach(() => {
    executeLiveBuyMock.mockReset();
    executeRaydiumDirectBuyMock.mockReset();
  });

  test("uses raydium direct path when it succeeds", async () => {
    const cfg = loadAppConfig("config/default.json");
    executeRaydiumDirectBuyMock.mockResolvedValue({
      intentId: "i1",
      ok: true,
      executedAtMs: Date.now(),
      inAmount: 1n,
      outAmount: 2n
    });

    const res = await executeRoutedLiveBuy({
      cfg,
      intent: {
        id: "i1",
        type: "BUY",
        intentKind: "ENTRY_TEST",
        mode: "live",
        mint: "mint",
        baseMint: cfg.assets.baseAssetMint,
        notionalUsd: 1,
        amountIn: 1n,
        slippageBps: 100,
        createdAtMs: Date.now(),
        reason: "test",
        positionId: "p1"
      },
      bestPair: null,
      wallet: {} as any,
      rpc: {} as any,
      jup: {} as any,
      raydium: {} as any,
      repos: {
        insertExecutionAttempt: vi.fn(),
        patchLatestExecutionRawByIntent: vi.fn()
      } as any,
      logger: {} as any
    });

    expect(res.entryPath).toBe("raydium_direct");
    expect(executeLiveBuyMock).not.toHaveBeenCalled();
  });

  test("falls back to jupiter when raydium direct fails", async () => {
    const cfg = loadAppConfig("config/default.json");
    executeRaydiumDirectBuyMock.mockResolvedValue({
      intentId: "i2",
      ok: false,
      err: "raydium_direct_unavailable",
      executedAtMs: Date.now()
    });
    executeLiveBuyMock.mockResolvedValue({
      intentId: "i2",
      ok: true,
      executedAtMs: Date.now(),
      inAmount: 1n,
      outAmount: 2n
    });

    const res = await executeRoutedLiveBuy({
      cfg,
      intent: {
        id: "i2",
        type: "BUY",
        intentKind: "ENTRY_TEST",
        mode: "live",
        mint: "mint",
        baseMint: cfg.assets.baseAssetMint,
        notionalUsd: 1,
        amountIn: 1n,
        slippageBps: 100,
        createdAtMs: Date.now(),
        reason: "test",
        positionId: "p1"
      },
      bestPair: null,
      wallet: {} as any,
      rpc: {} as any,
      jup: {} as any,
      raydium: {} as any,
      repos: {
        insertExecutionAttempt: vi.fn(),
        patchLatestExecutionRawByIntent: vi.fn()
      } as any,
      logger: {} as any
    });

    expect(res.entryPath).toBe("jupiter_fallback");
    expect(executeLiveBuyMock).toHaveBeenCalledTimes(1);
  });

  test("does not fall back when raydium result is post-send uncertain", async () => {
    const cfg = loadAppConfig("config/default.json");
    executeRaydiumDirectBuyMock.mockResolvedValue({
      intentId: "i2b",
      ok: false,
      err: "post_send_uncertain:send_not_confirmed:confirm_timeout",
      executedAtMs: Date.now()
    });

    const res = await executeRoutedLiveBuy({
      cfg,
      intent: {
        id: "i2b",
        type: "BUY",
        intentKind: "ENTRY_TEST",
        mode: "live",
        mint: "mint",
        baseMint: cfg.assets.baseAssetMint,
        notionalUsd: 1,
        amountIn: 1n,
        slippageBps: 100,
        createdAtMs: Date.now(),
        reason: "test",
        positionId: "p1"
      },
      bestPair: null,
      wallet: {} as any,
      rpc: {} as any,
      jup: {} as any,
      raydium: {} as any,
      repos: {
        insertExecutionAttempt: vi.fn(),
        patchLatestExecutionRawByIntent: vi.fn()
      } as any,
      logger: {} as any
    });

    expect(res.entryPath).toBe("raydium_direct");
    expect(res.execution.ok).toBe(false);
    expect(executeLiveBuyMock).not.toHaveBeenCalled();
  });

  test("uses jupiter only mode when configured", async () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.execution.router.entryMode = "jupiter_only";
    executeLiveBuyMock.mockResolvedValue({
      intentId: "i3",
      ok: true,
      executedAtMs: Date.now(),
      inAmount: 1n,
      outAmount: 2n
    });

    const res = await executeRoutedLiveBuy({
      cfg,
      intent: {
        id: "i3",
        type: "BUY",
        intentKind: "ENTRY_TEST",
        mode: "live",
        mint: "mint",
        baseMint: cfg.assets.baseAssetMint,
        notionalUsd: 1,
        amountIn: 1n,
        slippageBps: 100,
        createdAtMs: Date.now(),
        reason: "test",
        positionId: "p1"
      },
      bestPair: null,
      wallet: {} as any,
      rpc: {} as any,
      jup: {} as any,
      raydium: {} as any,
      repos: {
        insertExecutionAttempt: vi.fn(),
        patchLatestExecutionRawByIntent: vi.fn()
      } as any,
      logger: {} as any
    });

    expect(res.entryPath).toBe("jupiter_only");
    expect(executeRaydiumDirectBuyMock).not.toHaveBeenCalled();
  });
});
