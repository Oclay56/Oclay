import { describe, expect, test } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { analyzeHolders } from "../../src/analyzer/holders";
import { loadAppConfig } from "../../src/config/loadConfig";

describe("holders analysis", () => {
  test("aggregates by owner and excludes program-owned holders", async () => {
    const cfg = loadAppConfig("config/default.json");

    const mint = Keypair.generate().publicKey.toBase58();
    const ownerA = Keypair.generate().publicKey.toBase58();
    const ownerB = Keypair.generate().publicKey.toBase58();
    const programOwner = Keypair.generate().publicKey.toBase58();

    const tokenAcc1 = Keypair.generate().publicKey.toBase58();
    const tokenAcc2 = Keypair.generate().publicKey.toBase58();
    const tokenAcc3 = Keypair.generate().publicKey.toBase58();
    const tokenAcc4 = Keypair.generate().publicKey.toBase58();

    const parsedByTokenAcc: Record<string, string> = {
      [tokenAcc1]: ownerA,
      [tokenAcc2]: ownerA,
      [tokenAcc3]: ownerB,
      [tokenAcc4]: programOwner
    };

    const rpc: any = {
      commitment: "confirmed",
      getParsedAccountInfo: async (pubkey: string) => {
        const owner = parsedByTokenAcc[pubkey];
        return { value: { data: { parsed: { info: { owner } } } } };
      },
      getTokenSupply: async (_mint: string) => ({ value: { amount: "1000", decimals: 0 } }),
      getTokenLargestAccounts: async (_mint: string) => ({
        value: [
          { address: tokenAcc1, amount: "400" },
          { address: tokenAcc2, amount: "100" },
          { address: tokenAcc3, amount: "200" },
          { address: tokenAcc4, amount: "300" }
        ]
      }),
      getAccountInfo: async (pubkey: string) => {
        if (pubkey === programOwner) {
          return { owner: TOKEN_PROGRAM_ID } as any;
        }
        return { owner: SystemProgram.programId } as any;
      }
    };

    const res = await analyzeHolders(cfg, rpc, mint);
    expect(res.top1HolderPct).toBeCloseTo(50, 5);
    expect(res.top10HolderPct).toBeCloseTo(70, 5);
    expect(res.flags).toContain("TOP1_TOO_LARGE");
    expect(res.flags).toContain("TOP10_TOO_CONCENTRATED");
  });
});
