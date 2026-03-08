import { describe, expect, test } from "vitest";
import { SolanaRpc } from "../../src/providers/solanaRpc";

const itIf = process.env.RUN_INTEGRATION === "true" ? test : test.skip;

describe("integration: solana rpc", () => {
  itIf("fetches wSOL mint account", async () => {
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    const rpc = new SolanaRpc(rpcUrl);
    const wsol = "So11111111111111111111111111111111111111112";
    const info = await rpc.getAccountInfo(wsol);
    expect(info).not.toBeNull();
  }, 30_000);
});

