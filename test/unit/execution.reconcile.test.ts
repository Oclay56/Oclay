import { describe, expect, test } from "vitest";
import { reconcileSwapFromChain } from "../../src/execution/reconcile";

describe("execution reconcile", () => {
  test("reconciles BUY from token deltas", async () => {
    const wallet = "Wallet111111111111111111111111111111111111111";
    const inputMint = "So11111111111111111111111111111111111111112";
    const outputMint = "TokenMint11111111111111111111111111111111111";
    const rpc: any = {
      getTransactionWithRetry: async () => ({
        transaction: { message: { accountKeys: [wallet] } },
        meta: {
          preTokenBalances: [
            { owner: wallet, mint: inputMint, uiTokenAmount: { amount: "10000" } },
            { owner: wallet, mint: outputMint, uiTokenAmount: { amount: "0" } }
          ],
          postTokenBalances: [
            { owner: wallet, mint: inputMint, uiTokenAmount: { amount: "0" } },
            { owner: wallet, mint: outputMint, uiTokenAmount: { amount: "1200" } }
          ],
          preBalances: [1_000_000_000],
          postBalances: [999_900_000],
          fee: 5000
        }
      })
    };

    const res = await reconcileSwapFromChain({
      rpc,
      signature: "sig",
      wallet,
      inputMint,
      outputMint,
      intendedInputAmount: 10_000n,
      side: "BUY",
      positionDustAtoms: 1n
    });

    expect(res.reconcileOk).toBe(true);
    expect(res.reconciledOutAmount).toBe(1200n);
    expect(res.reconciledInAmount).toBe(10000n);
  });

  test("fails SELL reconcile when sold amount is underfilled", async () => {
    const wallet = "Wallet111111111111111111111111111111111111111";
    const inputMint = "TokenMint11111111111111111111111111111111111";
    const outputMint = "So11111111111111111111111111111111111111112";
    const rpc: any = {
      getTransactionWithRetry: async () => ({
        transaction: { message: { accountKeys: [wallet] } },
        meta: {
          preTokenBalances: [{ owner: wallet, mint: inputMint, uiTokenAmount: { amount: "1000" } }],
          postTokenBalances: [{ owner: wallet, mint: inputMint, uiTokenAmount: { amount: "900" } }],
          preBalances: [1_000_000_000],
          postBalances: [1_000_100_000],
          fee: 5000
        }
      })
    };

    const res = await reconcileSwapFromChain({
      rpc,
      signature: "sig",
      wallet,
      inputMint,
      outputMint,
      intendedInputAmount: 500n,
      side: "SELL",
      positionDustAtoms: 1n
    });

    expect(res.reconcileOk).toBe(false);
    expect(res.reconcileReason).toMatch(/sell_input_underfilled/);
  });

  test("fails SELL reconcile when output cannot be resolved", async () => {
    const wallet = "Wallet111111111111111111111111111111111111111";
    const inputMint = "TokenMint11111111111111111111111111111111111";
    const outputMint = "So11111111111111111111111111111111111111112";
    const rpc: any = {
      getTransactionWithRetry: async () => ({
        transaction: { message: { accountKeys: [wallet] } },
        meta: {
          preTokenBalances: [{ owner: wallet, mint: inputMint, uiTokenAmount: { amount: "1000" } }],
          postTokenBalances: [{ owner: wallet, mint: inputMint, uiTokenAmount: { amount: "0" } }],
          preBalances: [1_000_000_000],
          postBalances: [999_999_000],
          fee: 5000
        }
      })
    };

    const res = await reconcileSwapFromChain({
      rpc,
      signature: "sig",
      wallet,
      inputMint,
      outputMint,
      intendedInputAmount: 500n,
      side: "SELL",
      positionDustAtoms: 1n
    });

    expect(res.reconcileOk).toBe(false);
    expect(res.reconcileReason).toBe("sell_output_unresolved");
  });
});
