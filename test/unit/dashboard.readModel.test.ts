import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { runMigrations } from "../../src/storage/migrations";
import { readDashboardSnapshot } from "../../src/dashboard/readModel";

describe("dashboard read model", () => {
  test("maps DB rows into a bounded snapshot", () => {
    const db = new Database(":memory:");
    runMigrations(db as any);

    db.prepare("INSERT INTO tokens (mint, first_seen_at, last_seen_at, source) VALUES (?, ?, ?, ?);").run(
      "mintA",
      1000,
      2000,
      "test"
    );

    db.prepare(
      `
      INSERT INTO risk_reports (
        mint, created_at, flags_json, risk_score, opportunity_score, trade_score, metrics_json, reasons_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("mintA", 5000, JSON.stringify(["LOW_LIQUIDITY", "LOW_VOLUME"]), 40, 10, -38, "{}", "[]");

    db.prepare(
      `
      INSERT INTO positions (
        id, mint, mode, status, opened_at, closed_at,
        base_mint, entry_base_amount, entry_token_amount,
        exit_base_amount, entry_tx, exit_tx,
        entry_price_usd, exit_price_usd, pnl_usd, max_seen_price_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("pos-open", "mintA", "paper", "OPEN", 6000, null, "So111", "100000000", "1200000", null, null, null, 0.02, null, null, 0.03);

    db.prepare(
      `
      INSERT INTO positions (
        id, mint, mode, status, opened_at, closed_at,
        base_mint, entry_base_amount, entry_token_amount,
        exit_base_amount, entry_tx, exit_tx,
        entry_price_usd, exit_price_usd, pnl_usd, max_seen_price_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("pos-closed", "mintB", "paper", "CLOSED", 2000, 9000, "So111", "100", "200", "300", null, null, null, null, 1.23, null);

    db.prepare(
      `
      INSERT INTO executions (
        id, intent_id, position_id, mint, side, mode, requested_at, executed_at,
        ok, tx_sig, err, in_amount, out_amount, slippage_bps, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("exec-ok", "intent-ok", "pos-open", "mintA", "BUY", "paper", 7000, 7001, 1, null, null, "10", "20", 50, null);
    db.prepare(
      `
      INSERT INTO executions (
        id, intent_id, position_id, mint, side, mode, requested_at, executed_at,
        ok, tx_sig, err, in_amount, out_amount, slippage_bps, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("exec-fail", "intent-fail", "pos-open", "mintA", "SELL", "paper", 8000, 8001, 0, null, "boom", "20", null, 50, null);

    db.prepare("INSERT INTO blocks (mint, reason, blocked_at, expires_at) VALUES (?, ?, ?, ?);").run(
      "mintA",
      "probe_failed",
      6500,
      20_000
    );

    const snapshot = readDashboardSnapshot(db as any, {
      mode: "paper",
      startedAtMs: 0,
      nowMs: 10_000,
      refreshSec: 2,
      dbPath: "data/test.sqlite",
      rows: 1
    });

    expect(snapshot.counts.tokens).toBe(1);
    expect(snapshot.counts.riskReports).toBe(1);
    expect(snapshot.counts.openPositions).toBe(1);
    expect(snapshot.counts.closedPositions).toBe(1);
    expect(snapshot.counts.executions).toBe(2);
    expect(snapshot.counts.failedExecutions).toBe(1);
    expect(snapshot.counts.activeBlocks).toBe(1);
    expect(snapshot.activity.reportsLast1m).toBe(1);
    expect(snapshot.activity.executionsLast5m).toBe(2);
    expect(snapshot.recentReports).toHaveLength(1);
    expect(snapshot.recentReports[0]?.flags).toEqual(["LOW_LIQUIDITY", "LOW_VOLUME"]);
    expect(snapshot.openPositions).toHaveLength(1);
    expect(snapshot.recentExecutions).toHaveLength(1);
    expect(snapshot.recentExecutions[0]?.routerPath).toBe("jupiter_sell");
    expect(snapshot.activeBlocks).toHaveLength(1);
    expect(snapshot.health.staleRiskData).toBe(true);
    expect(snapshot.alerts.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.sell429.globalActive).toBe(false);
    expect(snapshot.streamHealth.enabled).toBe(false);
    expect(snapshot.mintRollups.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.focus?.mint).toBe("mintA");
  });

  test("empty database returns explicit empty sections", () => {
    const db = new Database(":memory:");
    runMigrations(db as any);

    const snapshot = readDashboardSnapshot(db as any, {
      mode: "paper",
      startedAtMs: 1_000,
      nowMs: 2_000,
      refreshSec: 2,
      dbPath: "data/test.sqlite",
      rows: 8
    });

    expect(snapshot.counts.tokens).toBe(0);
    expect(snapshot.recentReports).toEqual([]);
    expect(snapshot.openPositions).toEqual([]);
    expect(snapshot.recentExecutions).toEqual([]);
    expect(snapshot.activeBlocks).toEqual([]);
    expect(snapshot.health.staleRiskData).toBe(true);
    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.mintRollups).toEqual([]);
    expect(snapshot.focus).toBe(null);
  });
});
