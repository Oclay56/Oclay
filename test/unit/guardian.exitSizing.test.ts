import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { resolveLiveExitAmount } from "../../src/execution/exitSizing";
import { selectLiveExitSellableAmount } from "../../src/guardian/guardianLoop";

describe("guardian exit sizing", () => {
  test("caps by tracked amount and applies sell buffer", async () => {
    const cfg = loadAppConfig("config/default.json");
    const rpc: any = {
      getParsedTokenAccountsByOwner: async () => ({
        value: [
          { account: { data: { parsed: { info: { tokenAmount: { amount: "600" } } } } } },
          { account: { data: { parsed: { info: { tokenAmount: { amount: "400" } } } } } }
        ]
      })
    };

    const res = await resolveLiveExitAmount({
      cfg,
      rpc,
      wallet: "wallet",
      position: {
        id: "p1",
        mint: "mint",
        mode: "live",
        status: "OPEN",
        stage: "FULL",
        sniperMode: false,
        tpStep: 0,
        openedAtMs: Date.now(),
        baseMint: cfg.assets.baseAssetMint,
        entryBaseAmount: 1n,
        entryTokenAmount: 1_200n,
        initialTokenAmount: 1_200n,
        currentTokenAmount: 1_200n
      }
    });

    expect(res.walletBalance).toBe(1_000n);
    expect(res.lookupOk).toBe(true);
    expect(res.availableAmount).toBe(1_000n);
    expect(res.bufferedAmount).toBe(995n); // 1000 with 50bps buffer
    expect(res.amount).toBe(995n);
  });

  test("returns lookup failure instead of pretending the position is dust", async () => {
    const cfg = loadAppConfig("config/default.json");
    const rpc: any = {
      getParsedTokenAccountsByOwner: async () => {
        throw new Error("rpc down");
      }
    };

    const res = await resolveLiveExitAmount({
      cfg,
      rpc,
      wallet: "wallet",
      position: {
        id: "p1",
        mint: "mint",
        mode: "live",
        status: "OPEN",
        stage: "FULL",
        sniperMode: false,
        tpStep: 0,
        openedAtMs: Date.now(),
        baseMint: cfg.assets.baseAssetMint,
        entryBaseAmount: 1n,
        entryTokenAmount: 1_200n,
        initialTokenAmount: 1_200n,
        currentTokenAmount: 1_200n
      }
    });

    expect(res.lookupOk).toBe(false);
    expect(res.availableAmount).toBe(0n);
    expect(res.reason).toMatch(/wallet_balance_lookup_failed/);
  });

  test("uses unbuffered balance for full exits and buffered balance for ladder exits", () => {
    const resolved = {
      amount: 995n,
      availableAmount: 1_000n,
      bufferedAmount: 995n,
      walletBalance: 1_000n,
      trackedAmount: 1_200n,
      lookupOk: true,
      reason: "ok"
    };

    expect(selectLiveExitSellableAmount({ resolved, exitKind: "STOP", emergencyTriggered: false })).toBe(1_000n);
    expect(selectLiveExitSellableAmount({ resolved, exitKind: "TIME", emergencyTriggered: false })).toBe(1_000n);
    expect(selectLiveExitSellableAmount({ resolved, exitKind: "TP3", emergencyTriggered: false })).toBe(1_000n);
    expect(selectLiveExitSellableAmount({ resolved, exitKind: "TP1", emergencyTriggered: false })).toBe(995n);
    expect(selectLiveExitSellableAmount({ resolved, exitKind: undefined, emergencyTriggered: true })).toBe(1_000n);
  });
});
