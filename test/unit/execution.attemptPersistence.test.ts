import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { executeRoutedLiveBuy } from "../../src/execution/router";
import { openSqlite } from "../../src/storage/sqlite";
import { runMigrations } from "../../src/storage/migrations";
import { createRepos } from "../../src/storage/repos";

const executeLiveBuyMock = vi.fn();
const executeRaydiumDirectBuyMock = vi.fn();

vi.mock("../../src/execution/swap", () => ({
  executeLiveBuy: (...args: any[]) => executeLiveBuyMock(...args)
}));

vi.mock("../../src/execution/raydiumSwap", () => ({
  executeRaydiumDirectBuy: (...args: any[]) => executeRaydiumDirectBuyMock(...args)
}));

describe("execution attempt persistence", () => {
  test("raydium fail + jupiter fallback writes attempts and final execution", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oclay-attempts-"));
    const dbPath = path.join(dir, "test.sqlite");
    const db = openSqlite(dbPath);
    runMigrations(db);
    const repos = createRepos(db);
    const cfg = loadAppConfig("config/default.json");

    executeRaydiumDirectBuyMock.mockResolvedValue({
      intentId: "i-attempt",
      ok: false,
      err: "raydium_cpmm_build_failed",
      executedAtMs: Date.now(),
      inAmount: 10n
    });
    executeLiveBuyMock.mockImplementation(async ({ repos: r, intent }: any) => {
      const executedAtMs = Date.now();
      r.insertExecution({
        id: "exec-final",
        intentId: intent.id,
        positionId: intent.positionId,
        mint: intent.mint,
        side: "BUY",
        mode: "live",
        requestedAtMs: intent.createdAtMs,
        executedAtMs,
        ok: true,
        inAmount: intent.amountIn,
        outAmount: 20n,
        raw: { source: "mock" }
      });
      return {
        intentId: intent.id,
        ok: true,
        executedAtMs,
        inAmount: intent.amountIn,
        outAmount: 20n,
        raw: { source: "mock" }
      };
    });

    await executeRoutedLiveBuy({
      cfg,
      intent: {
        id: "i-attempt",
        type: "BUY",
        intentKind: "ENTRY_TEST",
        mode: "live",
        mint: "mint-attempt",
        baseMint: cfg.assets.baseAssetMint,
        notionalUsd: 1,
        amountIn: 10n,
        slippageBps: 100,
        createdAtMs: Date.now(),
        reason: "test",
        positionId: "p-attempt"
      },
      bestPair: null,
      wallet: {} as any,
      rpc: {} as any,
      jup: {} as any,
      raydium: {} as any,
      repos,
      logger: { info: () => undefined, warn: () => undefined, debug: () => undefined } as any
    });

    const attempts = db
      .prepare("SELECT router, attempt_no, ok FROM execution_attempts WHERE intent_id='i-attempt' ORDER BY attempt_no ASC;")
      .all() as any[];
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.router).toBe("raydium_direct");
    expect(attempts[1]?.router).toBe("jupiter");

    const exec = db
      .prepare("SELECT raw_json FROM executions WHERE intent_id='i-attempt' LIMIT 1;")
      .get() as any;
    const raw = JSON.parse(String(exec.raw_json));
    expect(Array.isArray(raw?.router?.attempts)).toBe(true);
    expect(raw.router.attempts.length).toBe(2);
    expect(String(raw.router.fallbackReason)).toContain("raydium");

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
