import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { runMigrations } from "../../src/storage/migrations";
import { readDashboardSnapshot } from "../../src/dashboard/readModel";

describe("dashboard execution path", () => {
  test("parses router path from raw_json and defaults SELL to jupiter_sell", () => {
    const db = new Database(":memory:");
    runMigrations(db as any);

    db.prepare(
      `
      INSERT INTO executions (
        id, intent_id, position_id, mint, side, mode, requested_at, executed_at,
        ok, tx_sig, err, in_amount, out_amount, slippage_bps, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run(
      "buy1",
      "ib1",
      null,
      "mintB",
      "BUY",
      "paper",
      20_000,
      20_001,
      1,
      null,
      null,
      "10",
      "20",
      100,
      JSON.stringify({ router: { entryPath: "jupiter_fallback" } })
    );

    db.prepare(
      `
      INSERT INTO executions (
        id, intent_id, position_id, mint, side, mode, requested_at, executed_at,
        ok, tx_sig, err, in_amount, out_amount, slippage_bps, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("sell1", "is1", null, "mintC", "SELL", "paper", 21_000, 21_001, 0, null, "failed", "20", "5", 100, null);

    const snapshot = readDashboardSnapshot(db as any, {
      mode: "paper",
      startedAtMs: 0,
      nowMs: 22_000,
      refreshSec: 2,
      dbPath: "data/test.sqlite",
      rows: 8
    });

    const buy = snapshot.recentExecutions.find((r) => r.mint === "mintB");
    const sell = snapshot.recentExecutions.find((r) => r.mint === "mintC");
    expect(buy?.routerPath).toBe("jupiter_fallback");
    expect(sell?.routerPath).toBe("jupiter_sell");
  });
});
