import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SqliteDb = Database.Database;

export function openSqlite(dbPath: string): SqliteDb {
  const resolved = path.resolve(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

