import { afterEach, describe, expect, test, vi } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { RaydiumProvider } from "../../src/providers/raydium";
import { executeRaydiumDirectBuy } from "../../src/execution/raydiumSwap";

describe("raydium cpmm provider/execution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("resolveDirectPool accepts Standard pool type as cpmm", async () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.execution.router.raydium.directEntryEnabled = true;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: "pair-1",
                type: "Standard",
                programId: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    const provider = new RaydiumProvider(cfg, { info: () => undefined } as any);
    const res = await provider.resolveDirectPool({
      chainId: "solana",
      dexId: "raydium",
      url: "",
      pairAddress: "pair-1",
      baseToken: { address: cfg.assets.baseAssetMint, symbol: "SOL", name: "SOL" },
      quoteToken: { address: cfg.assets.quoteAssetMint, symbol: "USDC", name: "USDC" }
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(res.eligible).toBe(true);
    expect(res.poolKind).toBe("cpmm");
  });

  test("executeRaydiumDirectBuy fails fast when direct entry is disabled", async () => {
    const cfg = loadAppConfig("config/default.json");
    const provider = new RaydiumProvider(cfg, { info: () => undefined } as any);
    const repos: any = { insertExecution: vi.fn() };
    const result = await executeRaydiumDirectBuy({
      cfg,
      intent: {
        id: "intent-1",
        type: "BUY",
        intentKind: "ENTRY_TEST",
        mode: "live",
        mint: "mint-1",
        baseMint: cfg.assets.baseAssetMint,
        notionalUsd: 1,
        amountIn: 1n,
        slippageBps: 100,
        createdAtMs: Date.now(),
        reason: "test",
        positionId: "pos-1"
      },
      bestPair: null,
      wallet: {} as any,
      rpc: {} as any,
      raydium: provider,
      repos,
      logger: { info: () => undefined, warn: () => undefined } as any
    });

    expect(result.ok).toBe(false);
    expect(result.err).toContain("raydium_direct_not_eligible");
  });
});
