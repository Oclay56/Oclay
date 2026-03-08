import { describe, expect, test } from "vitest";
import { JupiterUltraClient } from "../../src/providers/jupiterUltra";
import { createLogger } from "../../src/utils/log";

const itIf = process.env.RUN_INTEGRATION === "true" ? test : test.skip;

describe("integration: jupiter ultra", () => {
  itIf("fetches a quote (SOL -> USDC) via lite-api", async () => {
    const logger = createLogger("silent");
    const baseUrl = process.env.JUP_BASE_URL || "https://lite-api.jup.ag/ultra/v1";
    const jup = new JupiterUltraClient(baseUrl, process.env.JUP_API_KEY, logger);

    const solMint = "So11111111111111111111111111111111111111112";
    const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const q = await jup.getOrder({ inputMint: solMint, outputMint: usdcMint, amount: "10000000" }); // 0.01 SOL
    expect(BigInt(q.outAmount)).toBeGreaterThan(0n);
    expect(Array.isArray(q.routePlan)).toBe(true);
  }, 30_000);
});

