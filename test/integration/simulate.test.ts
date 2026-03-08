import { describe, expect, test } from "vitest";
import { createLogger } from "../../src/utils/log";
import { JupiterUltraClient } from "../../src/providers/jupiterUltra";
import { SolanaRpc } from "../../src/providers/solanaRpc";
import { loadKeypairFromFile } from "../../src/execution/wallet";

const itIf =
  process.env.RUN_INTEGRATION === "true" &&
  process.env.RUN_TX_SIM === "true" &&
  !!process.env.WALLET_KEYPAIR_PATH
    ? test
    : test.skip;

describe("integration: tx simulation", () => {
  itIf("builds a Jupiter Ultra order tx and simulates it (requires funded wallet)", async () => {
    const logger = createLogger("silent");
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    const rpc = new SolanaRpc(rpcUrl);

    const baseUrl = process.env.JUP_BASE_URL || "https://lite-api.jup.ag/ultra/v1";
    const jup = new JupiterUltraClient(baseUrl, process.env.JUP_API_KEY, logger);

    const wallet = loadKeypairFromFile(process.env.WALLET_KEYPAIR_PATH!);

    const solMint = "So11111111111111111111111111111111111111112";
    const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

    const o = await jup.getOrder({
      inputMint: solMint,
      outputMint: usdcMint,
      amount: "1000000",
      taker: wallet.publicKey.toBase58(),
      slippageBps: 50
    });

    expect(o.transaction).toBeTypeOf("string");
    expect((o.transaction as string).length).toBeGreaterThan(50);

    const sim = await rpc.simulateBase64Tx(o.transaction as string);
    expect(Array.isArray(sim.logs)).toBe(true);
  }, 60_000);
});

