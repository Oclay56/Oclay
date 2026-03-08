import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { parseStreamCandidates } from "../../src/discovery/streamParsers";

describe("discovery decoder priority", () => {
  test("decoder result wins over heuristic when both could match", () => {
    const cfg = loadAppConfig("config/default.json");
    const event = {
      programId: "CPMMoo8L3F4NbTegBCKVNfS2bY2Gb5j2qWQY3X2Y9E7",
      signature: "sig-priority",
      slot: 1,
      logs: ["Program log: add_liquidity swap"],
      atMs: Date.now()
    };
    const tx = {
      transaction: {
        message: {
          accountKeys: [event.programId, "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"],
          instructions: [{ programIdIndex: 0, accounts: [1, 2, 3, 4, 5, 6, 7, 8], data: "A" }] // opcode 9 => swap
        }
      },
      meta: {
        preTokenBalances: [{ mint: "HdpQz8Q9Jfp8hR8bEjjM37fQ38sZ4N2VN6i393XWmM9n", accountIndex: 1, uiTokenAmount: { amount: "100" } }],
        postTokenBalances: [{ mint: "HdpQz8Q9Jfp8hR8bEjjM37fQ38sZ4N2VN6i393XWmM9n", accountIndex: 1, uiTokenAmount: { amount: "80" } }]
      }
    };
    const out = parseStreamCandidates({ cfg, event: event as any, tx });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.parsePath).toBe("instruction");
    expect(out[0]?.reason).toContain("decoder_");
  });
});
