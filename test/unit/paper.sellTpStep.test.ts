import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { executePaperSell } from "../../src/execution/paper";
import type { Position, TradeIntent } from "../../src/domain/types";

describe("paper sell tpStep updates", () => {
  test("advances tpStep from intent kind to prevent repeated TP1 loops", async () => {
    const cfg = loadAppConfig("config/default.json");
    const updates: any[] = [];
    const repos: any = {
      updatePosition: (patch: any) => updates.push(patch),
      insertExecution: () => undefined
    };
    const jup: any = {
      getOrder: async () => ({
        outAmount: "1000",
        priceImpactPct: "0",
        raw: {}
      })
    };
    const logger: any = { info: () => undefined };
    const position: Position = {
      id: "p1",
      mint: "mint",
      mode: "paper",
      status: "OPEN",
      stage: "FULL",
      sniperMode: false,
      tpStep: 0,
      openedAtMs: Date.now(),
      baseMint: cfg.assets.baseAssetMint,
      entryBaseAmount: 10_000n,
      entryTokenAmount: 1_000n,
      initialTokenAmount: 1_000n,
      currentTokenAmount: 1_000n
    };
    const intent: TradeIntent = {
      id: "i1",
      type: "SELL",
      intentKind: "EXIT_TP1",
      mode: "paper",
      mint: "mint",
      baseMint: cfg.assets.baseAssetMint,
      notionalUsd: 0,
      amountIn: 300n,
      slippageBps: cfg.execution.slippageBpsExit,
      createdAtMs: Date.now(),
      reason: "tp1"
    };

    await executePaperSell({
      cfg,
      position,
      intent,
      amountIn: intent.amountIn,
      bestPair: null,
      jup,
      repos,
      logger,
      baseAssetUsdPrice: 100,
      reason: "tp1"
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].tpStep).toBe(1);
  });
});
