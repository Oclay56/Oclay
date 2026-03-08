import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { runMigrations } from "../../src/storage/migrations";
import { readDashboardSnapshot } from "../../src/dashboard/readModel";

describe("dashboard rollups", () => {
  test("computes failed sells, route health, and active-first sorting", () => {
    const db = new Database(":memory:");
    runMigrations(db as any);

    db.prepare(
      `
      INSERT INTO positions (
        id, mint, mode, status, opened_at, closed_at, base_mint,
        entry_base_amount, entry_token_amount, exit_base_amount,
        entry_tx, exit_tx, entry_price_usd, exit_price_usd, pnl_usd, max_seen_price_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("p1", "mintA", "paper", "OPEN", 1_000, null, "So111", "100", "200", null, null, null, null, null, null, null);

    db.prepare(
      `
      INSERT INTO executions (
        id, intent_id, position_id, mint, side, mode, requested_at, executed_at,
        ok, tx_sig, err, in_amount, out_amount, slippage_bps, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("e1", "i1", null, "mintA", "SELL", "paper", 59_000, 59_001, 0, null, "fail", "10", "1", 100, null);
    db.prepare(
      `
      INSERT INTO executions (
        id, intent_id, position_id, mint, side, mode, requested_at, executed_at,
        ok, tx_sig, err, in_amount, out_amount, slippage_bps, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("e2", "i2", null, "mintB", "SELL", "paper", 59_500, 59_501, 0, null, "fail", "10", "1", 100, null);

    db.prepare(
      `
      INSERT INTO risk_reports (
        mint, created_at, flags_json, risk_score, opportunity_score, trade_score, metrics_json, reasons_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("mintB", 59_800, JSON.stringify(["EXIT_ROUTE_GONE"]), 50, 1, -20, "{}", "[]");

    const snapshot = readDashboardSnapshot(db as any, {
      mode: "paper",
      startedAtMs: 0,
      nowMs: 60_000,
      refreshSec: 2,
      dbPath: "data/test.sqlite",
      rows: 8,
      rollupWindowMin: 60
    });

    expect(snapshot.mintRollups.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.mintRollups[0]?.mint).toBe("mintA");
    expect(snapshot.mintRollups[0]?.hasActivePosition).toBe(true);
    const mintB = snapshot.mintRollups.find((r) => r.mint === "mintB");
    expect(mintB?.failedSells5m).toBeGreaterThanOrEqual(1);
    expect(mintB?.routeOk).toBe(false);
  });
});
