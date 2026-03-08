import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { parseStreamCandidates } from "../../src/discovery/streamParsers";

describe("stream parser", () => {
  test("uses decoder-first classification when discriminator is present", () => {
    const cfg = loadAppConfig("config/default.json");
    const event = {
      programId: "CPMMoo8L3F4NbTegBCKVNfS2bY2Gb5j2qWQY3X2Y9E7",
      signature: "sig-1",
      slot: 1,
      logs: ["Program log: swap"],
      atMs: Date.now()
    };
    const tx = {
      transaction: {
        message: {
          accountKeys: [event.programId, "acct1", "acct2", "acct3", "acct4", "acct5", "acct6", "acct7", "acct8"],
          instructions: [{ programIdIndex: 0, accounts: [1, 2, 3, 4, 5, 6, 7, 8], data: "A" }] // bs58 "A" => 0x09
        }
      },
      meta: {
        preTokenBalances: [{ mint: "So11111111111111111111111111111111111111112", accountIndex: 1, uiTokenAmount: { amount: "100" } }],
        postTokenBalances: [{ mint: "So11111111111111111111111111111111111111112", accountIndex: 1, uiTokenAmount: { amount: "90" } }]
      }
    };

    const out = parseStreamCandidates({ cfg, event: event as any, tx });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.kind).toBe("EARLY_SWAP");
    expect(out[0]?.parsePath).toBe("instruction");
    expect(out[0]?.reason).toContain("decoder_opcode");
  });

  test("falls back to heuristic when decoder path cannot classify", () => {
    const cfg = loadAppConfig("config/default.json");
    const event = {
      programId: "CPMMoo8L3F4NbTegBCKVNfS2bY2Gb5j2qWQY3X2Y9E7",
      signature: "sig-2",
      slot: 1,
      logs: ["Program log: add_liquidity"],
      atMs: Date.now()
    };
    const tx = {
      transaction: {
        message: {
          accountKeys: [event.programId, "acct1", "acct2", "acct3", "acct4"],
          instructions: [{ programIdIndex: 0, accounts: [1, 2], data: "11" }]
        }
      },
      meta: {
        preTokenBalances: [
          { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", accountIndex: 1, uiTokenAmount: { amount: "10" } },
          { mint: "So11111111111111111111111111111111111111112", accountIndex: 2, uiTokenAmount: { amount: "20" } }
        ],
        postTokenBalances: [
          { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", accountIndex: 1, uiTokenAmount: { amount: "12" } },
          { mint: "So11111111111111111111111111111111111111112", accountIndex: 2, uiTokenAmount: { amount: "18" } }
        ]
      }
    };

    const out = parseStreamCandidates({ cfg, event: event as any, tx });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.parsePath).toBe("heuristic");
    expect(out[0]?.kind).toBe("LIQ_ADD");
    expect(out[0]?.reason).toContain("heuristic_path");
  });

  test("filters heuristic candidates below decoder fallback floor", () => {
    const cfg = loadAppConfig("config/default.json");
    cfg.discovery.stream.decoderFallbackConfidenceFloor = 0.9;
    cfg.discovery.stream.minCandidateConfidence = 0.7;
    const event = {
      programId: "CPMMoo8L3F4NbTegBCKVNfS2bY2Gb5j2qWQY3X2Y9E7",
      signature: "sig-3",
      slot: 1,
      logs: ["Program log: swap"],
      atMs: Date.now()
    };
    const tx = {
      transaction: {
        message: {
          accountKeys: [event.programId, "acct1"],
          instructions: [{ programIdIndex: 0, accounts: [1], data: "00" }]
        }
      },
      meta: {
        preTokenBalances: [{ mint: "So11111111111111111111111111111111111111112", accountIndex: 1, uiTokenAmount: { amount: "10" } }],
        postTokenBalances: [{ mint: "So11111111111111111111111111111111111111112", accountIndex: 1, uiTokenAmount: { amount: "8" } }]
      }
    };

    const out = parseStreamCandidates({ cfg, event: event as any, tx });
    expect(out).toHaveLength(0);
  });
});
