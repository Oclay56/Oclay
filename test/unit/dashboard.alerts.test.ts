import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { runMigrations } from "../../src/storage/migrations";
import { readDashboardSnapshot } from "../../src/dashboard/readModel";

describe("dashboard alerts", () => {
  test("dedupes critical alerts by (code,mint)", () => {
    const db = new Database(":memory:");
    runMigrations(db as any);

    db.prepare(
      `
      INSERT INTO executions (
        id, intent_id, position_id, mint, side, mode, requested_at, executed_at,
        ok, tx_sig, err, in_amount, out_amount, slippage_bps, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("e1", "i1", null, "mintA", "SELL", "paper", 10_000, 10_001, 0, null, "Jupiter Ultra 429 rate limit", null, null, 100, null);
    db.prepare(
      `
      INSERT INTO executions (
        id, intent_id, position_id, mint, side, mode, requested_at, executed_at,
        ok, tx_sig, err, in_amount, out_amount, slippage_bps, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("e2", "i2", null, "mintA", "SELL", "paper", 10_500, 10_501, 0, null, "Jupiter Ultra 429 rate limit", null, null, 100, null);

    db.prepare(
      `
      INSERT INTO risk_reports (
        mint, created_at, flags_json, risk_score, opportunity_score, trade_score, metrics_json, reasons_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("mintA", 11_000, JSON.stringify(["EXIT_ROUTE_GONE", "LOW_VOLUME"]), 60, 1, -50, "{}", "[]");

    const snapshot = readDashboardSnapshot(db as any, {
      mode: "paper",
      startedAtMs: 0,
      nowMs: 12_000,
      refreshSec: 2,
      dbPath: "data/test.sqlite",
      rows: 8,
      alertsWindowMin: 15
    });

    const jup429 = snapshot.alerts.find((a) => a.code === "JUP_429" && a.mint === "mintA");
    expect(jup429).toBeTruthy();
    expect(jup429?.count).toBe(2);
    expect(snapshot.alerts.some((a) => a.code === "LOW_VOLUME")).toBe(false);
    expect(snapshot.alerts.some((a) => a.code === "EXIT_ROUTE_GONE")).toBe(true);
  });
});
