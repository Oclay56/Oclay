import type { SqliteDb } from "./sqlite";

interface Migration {
  id: number;
  name: string;
  up: (db: SqliteDb) => void;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "initial",
    up: (db) => {
      db.exec(
        `
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tokens (
          mint TEXT PRIMARY KEY,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          source TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS token_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mint TEXT NOT NULL,
          captured_at INTEGER NOT NULL,
          pair_address TEXT,
          dex_id TEXT,
          url TEXT,
          price_usd REAL,
          price_native REAL,
          liquidity_usd REAL,
          volume_m5 REAL,
          volume_h1 REAL,
          volume_h6 REAL,
          volume_h24 REAL,
          buys_m5 INTEGER,
          sells_m5 INTEGER,
          buys_h1 INTEGER,
          sells_h1 INTEGER,
          buys_h6 INTEGER,
          sells_h6 INTEGER,
          buys_h24 INTEGER,
          sells_h24 INTEGER,
          price_change_m5 REAL,
          price_change_h1 REAL,
          price_change_h6 REAL,
          price_change_h24 REAL,
          pair_created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS risk_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mint TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          flags_json TEXT NOT NULL,
          risk_score REAL NOT NULL,
          opportunity_score REAL NOT NULL,
          trade_score REAL NOT NULL,
          metrics_json TEXT NOT NULL,
          reasons_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dev_wallets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mint TEXT NOT NULL,
          wallet TEXT NOT NULL,
          role TEXT NOT NULL,
          confidence REAL NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS positions (
          id TEXT PRIMARY KEY,
          mint TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          opened_at INTEGER NOT NULL,
          closed_at INTEGER,
          base_mint TEXT NOT NULL,
          entry_base_amount TEXT NOT NULL,
          entry_token_amount TEXT NOT NULL,
          exit_base_amount TEXT,
          entry_tx TEXT,
          exit_tx TEXT,
          entry_price_usd REAL,
          exit_price_usd REAL,
          pnl_usd REAL,
          max_seen_price_usd REAL
        );
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          intent_id TEXT NOT NULL,
          position_id TEXT,
          mint TEXT NOT NULL,
          side TEXT NOT NULL,
          mode TEXT NOT NULL,
          requested_at INTEGER NOT NULL,
          executed_at INTEGER,
          ok INTEGER NOT NULL,
          tx_sig TEXT,
          err TEXT,
          in_amount TEXT,
          out_amount TEXT,
          slippage_bps INTEGER,
          raw_json TEXT
        );
        CREATE TABLE IF NOT EXISTS blocks (
          mint TEXT PRIMARY KEY,
          reason TEXT NOT NULL,
          blocked_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        `.trim()
      );
      createIndexIfMissing(db, "idx_token_snapshots_mint_time", "token_snapshots(mint, captured_at)");
      createIndexIfMissing(db, "idx_risk_reports_mint_time", "risk_reports(mint, created_at)");
      createIndexIfMissing(db, "idx_dev_wallets_mint", "dev_wallets(mint)");
      createIndexIfMissing(db, "idx_positions_status", "positions(status)");
      createIndexIfMissing(db, "idx_executions_mint_time", "executions(mint, requested_at)");
      createIndexIfMissing(db, "idx_blocks_expires", "blocks(expires_at)");
    }
  },
  {
    id: 2,
    name: "sniper_stream_telemetry",
    up: (db) => {
      addColumnIfMissing(db, "positions", "initial_token_amount", "TEXT");
      addColumnIfMissing(db, "positions", "current_token_amount", "TEXT");
      addColumnIfMissing(db, "positions", "sniper_mode", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "positions", "tp_step", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "positions", "stage", "TEXT NOT NULL DEFAULT 'FULL'");

      db.exec(
        `
        UPDATE positions
        SET initial_token_amount = entry_token_amount
        WHERE initial_token_amount IS NULL;
        UPDATE positions
        SET current_token_amount = entry_token_amount
        WHERE current_token_amount IS NULL;
        CREATE TABLE IF NOT EXISTS position_legs (
          id TEXT PRIMARY KEY,
          position_id TEXT NOT NULL,
          mint TEXT NOT NULL,
          side TEXT NOT NULL,
          intent_kind TEXT NOT NULL,
          requested_at INTEGER NOT NULL,
          executed_at INTEGER,
          in_amount TEXT,
          out_amount TEXT,
          ok INTEGER NOT NULL,
          tx_sig TEXT,
          err TEXT,
          raw_json TEXT
        );
        CREATE TABLE IF NOT EXISTS trade_lifecycle_events (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          mint TEXT NOT NULL,
          position_id TEXT,
          intent_id TEXT,
          stage TEXT NOT NULL,
          at_ms INTEGER NOT NULL,
          meta_json TEXT
        );
        CREATE TABLE IF NOT EXISTS trade_attribution (
          id TEXT PRIMARY KEY,
          position_id TEXT NOT NULL,
          mint TEXT NOT NULL,
          mode TEXT NOT NULL,
          opened_at INTEGER NOT NULL,
          closed_at INTEGER NOT NULL,
          hold_ms INTEGER NOT NULL,
          pnl_usd REAL,
          features_json TEXT NOT NULL
        );
        `.trim()
      );
      createIndexIfMissing(db, "idx_position_legs_position_time", "position_legs(position_id, requested_at)");
      createIndexIfMissing(db, "idx_trade_lifecycle_mint_time", "trade_lifecycle_events(mint, at_ms)");
      createIndexIfMissing(db, "idx_trade_attribution_closed", "trade_attribution(closed_at)");
    }
  },
  {
    id: 3,
    name: "lifecycle_candidate_indexing",
    up: (db) => {
      addColumnIfMissing(db, "trade_lifecycle_events", "candidate_id", "TEXT");
      createIndexIfMissing(
        db,
        "idx_lifecycle_candidate_stage_time",
        "trade_lifecycle_events(candidate_id, stage, at_ms)"
      );
      createIndexIfMissing(
        db,
        "idx_lifecycle_intent_stage_time",
        "trade_lifecycle_events(intent_id, stage, at_ms)"
      );
      createIndexIfMissing(
        db,
        "idx_lifecycle_position_stage_time",
        "trade_lifecycle_events(position_id, stage, at_ms)"
      );
    }
  },
  {
    id: 4,
    name: "execution_attempts",
    up: (db) => {
      db.exec(
        `
        CREATE TABLE IF NOT EXISTS execution_attempts (
          id TEXT PRIMARY KEY,
          intent_id TEXT NOT NULL,
          position_id TEXT,
          mint TEXT NOT NULL,
          router TEXT NOT NULL,
          attempt_no INTEGER NOT NULL,
          stage TEXT NOT NULL,
          ok INTEGER NOT NULL,
          tx_sig TEXT,
          err TEXT,
          in_amount TEXT,
          out_amount TEXT,
          requested_at INTEGER NOT NULL,
          executed_at INTEGER,
          raw_json TEXT
        );
        `.trim()
      );
      createIndexIfMissing(
        db,
        "idx_execution_attempts_intent_time",
        "execution_attempts(intent_id, requested_at)"
      );
      createIndexIfMissing(
        db,
        "idx_execution_attempts_mint_time",
        "execution_attempts(mint, requested_at)"
      );
    }
  },
  {
    id: 5,
    name: "lifecycle_stage_time_index",
    up: (db) => {
      createIndexIfMissing(
        db,
        "idx_trade_lifecycle_stage_time",
        "trade_lifecycle_events(stage, at_ms)"
      );
    }
  }
];

export function runMigrations(db: SqliteDb): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);"
  );
  const applied = new Set<number>(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((r: any) => Number(r.id))
  );

  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      db.prepare("INSERT OR REPLACE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?);").run(
        m.id,
        m.name,
        Date.now()
      );
    });
    tx();
  }
}

function addColumnIfMissing(db: SqliteDb, table: string, column: string, definition: string): void {
  if (hasColumn(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

function hasColumn(db: SqliteDb, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${escapeSingleQuote(table)});`).all() as Array<{ name?: string }>;
  return rows.some((r) => String(r.name ?? "").toLowerCase() === column.toLowerCase());
}

function createIndexIfMissing(db: SqliteDb, indexName: string, target: string): void {
  if (hasIndex(db, indexName)) return;
  db.exec(`CREATE INDEX ${indexName} ON ${target};`);
}

function hasIndex(db: SqliteDb, indexName: string): boolean {
  const row = db
    .prepare("SELECT 1 as ok FROM sqlite_master WHERE type='index' AND name=? LIMIT 1;")
    .get(indexName) as { ok?: number } | undefined;
  return Number(row?.ok ?? 0) === 1;
}

function escapeSingleQuote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
