import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { runMigrations } from "../../src/storage/migrations";
import { readDashboardSnapshot } from "../../src/dashboard/readModel";

describe("dashboard focus selection", () => {
  test("uses focusMint override when mint is in current snapshot universe", () => {
    const db = new Database(":memory:");
    runMigrations(db as any);

    db.prepare(
      `
      INSERT INTO executions (
        id, intent_id, position_id, mint, side, mode, requested_at, executed_at,
        ok, tx_sig, err, in_amount, out_amount, slippage_bps, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("e1", "i1", null, "mintX", "BUY", "paper", 10_000, 10_001, 1, null, null, "1", "2", 50, null);

    const snapshot = readDashboardSnapshot(db as any, {
      mode: "paper",
      startedAtMs: 0,
      nowMs: 11_000,
      refreshSec: 2,
      dbPath: "data/test.sqlite",
      rows: 8,
      focusMint: "mintX"
    });

    expect(snapshot.focus?.mint).toBe("mintX");
    expect(snapshot.focus?.reason).toBe("cli_focus");
  });

  test("auto-smart picks open position first", () => {
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
    ).run("p1", "mintOpen", "paper", "OPEN", 10_000, null, "So111", "10", "20", null, null, null, null, null, null, null);

    db.prepare(
      `
      INSERT INTO executions (
        id, intent_id, position_id, mint, side, mode, requested_at, executed_at,
        ok, tx_sig, err, in_amount, out_amount, slippage_bps, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
    ).run("e1", "i1", null, "mintFail", "SELL", "paper", 9_000, 9_001, 0, null, "failed", null, null, 50, null);

    const snapshot = readDashboardSnapshot(db as any, {
      mode: "paper",
      startedAtMs: 0,
      nowMs: 11_000,
      refreshSec: 2,
      dbPath: "data/test.sqlite",
      rows: 8
    });

    expect(snapshot.focus?.mint).toBe("mintOpen");
    expect(snapshot.focus?.reason).toBe("open_position");
  });
});
