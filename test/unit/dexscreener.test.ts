import { describe, expect, test } from "vitest";
import { DexScreenerClient } from "../../src/providers/dexscreener";
import { createLogger } from "../../src/utils/log";

describe("DexScreener pair selection", () => {
  test("parses latest token profiles (array root)", async () => {
    const logger = createLogger("silent");
    const dex = new DexScreenerClient("https://api.dexscreener.com", logger);

    const prevFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      return {
        ok: true,
        json: async () => [
          { url: "u", chainId: "solana", tokenAddress: "m1" },
          { url: "u2", chainId: "ethereum", tokenAddress: "0xabc" }
        ]
      } as any;
    };

    try {
      const profiles = await dex.getLatestTokenProfiles();
      expect(profiles).toEqual([{ url: "u", chainId: "solana", tokenAddress: "m1" }, { url: "u2", chainId: "ethereum", tokenAddress: "0xabc" }]);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  test("selects highest liquidity with allowlist boost", () => {
    const logger = createLogger("silent");
    const dex = new DexScreenerClient("https://api.dexscreener.com", logger);

    const pairs: any[] = [
      {
        chainId: "solana",
        dexId: "unknownDex",
        url: "u1",
        pairAddress: "p1",
        baseToken: { address: "mintA", symbol: "A", name: "A" },
        quoteToken: { address: "mintB", symbol: "B", name: "B" },
        liquidityUsd: 100_000
      },
      {
        chainId: "solana",
        dexId: "raydium",
        url: "u2",
        pairAddress: "p2",
        baseToken: { address: "mintA", symbol: "A", name: "A" },
        quoteToken: { address: "mintB", symbol: "B", name: "B" },
        liquidityUsd: 95_000
      }
    ];

    const best = dex.selectBestPair({
      pairs,
      minLiquidityUsd: 0,
      dexAllowlist: ["raydium"],
      preferMints: []
    });
    // allowlist boosts raydium but not enough to beat much higher liquidity
    expect(best?.pairAddress).toBe("p1");
  });

  test("rejects pairs below min liquidity", () => {
    const logger = createLogger("silent");
    const dex = new DexScreenerClient("https://api.dexscreener.com", logger);

    const pairs: any[] = [
      {
        chainId: "solana",
        dexId: "raydium",
        url: "u2",
        pairAddress: "p2",
        baseToken: { address: "mintA", symbol: "A", name: "A" },
        quoteToken: { address: "mintB", symbol: "B", name: "B" },
        liquidityUsd: 100
      }
    ];

    const best = dex.selectBestPair({
      pairs,
      minLiquidityUsd: 10_000,
      dexAllowlist: ["raydium"],
      preferMints: []
    });
    expect(best).toBeNull();
  });
});
