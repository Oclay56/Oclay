import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { SystemProgram } from "@solana/web3.js";
import { loadAppConfig } from "../../src/config/loadConfig";

describe("holders cooldown behavior", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("429 triggers temporary cooldown and retries after expiry", async () => {
    const cfg = loadAppConfig("config/default.json");
    const mint = "Mint111111111111111111111111111111111111111";
    const tokenAcc = "TokenAcc11111111111111111111111111111111111";
    const owner = "Owner11111111111111111111111111111111111111";
    const now = 1_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const { analyzeHolders } = await import("../../src/analyzer/holders");

    const rpc429: any = {
      getTokenSupply: async () => ({ value: { amount: "1000", decimals: 0 } }),
      getTokenLargestAccounts: async () => {
        throw new Error("429");
      }
    };

    const first = await analyzeHolders(cfg, rpc429, mint);
    expect(first.flags).toContain("HOLDERS_UNKNOWN");

    const rpcOk: any = {
      getTokenSupply: async () => ({ value: { amount: "1000", decimals: 0 } }),
      getTokenLargestAccounts: vi.fn(async () => ({
        value: [{ address: tokenAcc, amount: "500" }]
      })),
      getParsedAccountInfo: async () => ({
        value: { data: { parsed: { info: { owner } } } }
      }),
      getAccountInfo: async () => ({ owner: SystemProgram.programId })
    };

    const duringCooldown = await analyzeHolders(cfg, rpcOk, mint);
    expect(duringCooldown.flags).toContain("HOLDERS_UNKNOWN");
    expect(rpcOk.getTokenLargestAccounts).not.toHaveBeenCalled();

    nowSpy.mockReturnValue(now + cfg.analysis.holders.rateLimitCooldownMs + 1);
    const afterCooldown = await analyzeHolders(cfg, rpcOk, mint);
    expect(afterCooldown.flags).not.toContain("HOLDERS_UNKNOWN");
    expect(rpcOk.getTokenLargestAccounts).toHaveBeenCalledTimes(1);
  });
});
