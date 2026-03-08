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

describe("integration: router raydium fallback smoke", () => {
  beforeEach(() => {
    executeLiveBuyMock.mockReset();
    executeRaydiumDirectBuyMock.mockReset();
  });

  test("falls back to jupiter when direct path fails", async () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.execution.router.raydium.directEntryEnabled = true;
    executeRaydiumDirectBuyMock.mockResolvedValue({
      intentId: "i1",
      ok: false,
      err: "raydium_direct_failed",
      executedAtMs: Date.now()
    });
    executeLiveBuyMock.mockResolvedValue({
      intentId: "i1",
      ok: true,
      executedAtMs: Date.now(),
      inAmount: 1n,
      outAmount: 2n,
      raw: {}
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

    expect(res.entryPath).toBe("jupiter_fallback");
    expect(res.execution.ok).toBe(true);
    expect((res.execution.raw as any)?.router?.fallbackReason).toContain("raydium_direct_failed");
  });
});
