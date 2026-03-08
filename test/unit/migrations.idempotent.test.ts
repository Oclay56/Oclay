import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openSqlite } from "../../src/storage/sqlite";
import { runMigrations } from "../../src/storage/migrations";

describe("migrations idempotence", () => {
  test("reruns safely after partial migration marker rollback", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oclay-mig-idem-"));
    const dbPath = path.join(dir, "test.sqlite");
    const db = openSqlite(dbPath);

    runMigrations(db);
    db.prepare("DELETE FROM schema_migrations WHERE id IN (2,3,4);").run();

    expect(() => runMigrations(db)).not.toThrow();

    const candidateColumn = db
      .prepare("SELECT COUNT(1) as c FROM pragma_table_info('trade_lifecycle_events') WHERE name='candidate_id';")
      .get() as any;
    expect(Number(candidateColumn?.c ?? 0)).toBe(1);

    const attemptsTable = db
      .prepare("SELECT COUNT(1) as c FROM sqlite_master WHERE type='table' AND name='execution_attempts';")
      .get() as any;
    expect(Number(attemptsTable?.c ?? 0)).toBe(1);

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
