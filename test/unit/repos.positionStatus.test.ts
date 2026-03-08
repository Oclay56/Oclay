import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openSqlite } from "../../src/storage/sqlite";
import { runMigrations } from "../../src/storage/migrations";
import { createRepos } from "../../src/storage/repos";
import { loadAppConfig } from "../../src/config/loadConfig";

describe("repos active position status handling", () => {
  test("treats EXITING as active and normalizes ENTERING on startup", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oclay-repos-"));
    const dbPath = path.join(dir, "test.sqlite");
    const db = openSqlite(dbPath);
    runMigrations(db);
    const repos = createRepos(db);
    const cfg = loadAppConfig("config/default.json");
    const now = Date.now();

    repos.createPosition({
      id: "open",
      mint: "mint-open",
      mode: "paper",
      status: "OPEN",
      stage: "FULL",
      sniperMode: false,
      tpStep: 0,
      openedAtMs: now,
      baseMint: cfg.assets.baseAssetMint,
      entryBaseAmount: 1n,
      entryTokenAmount: 1n,
      initialTokenAmount: 1n,
      currentTokenAmount: 1n
    });
    repos.createPosition({
      id: "exiting",
      mint: "mint-exit",
      mode: "paper",
      status: "EXITING",
      stage: "FULL",
      sniperMode: false,
      tpStep: 0,
      openedAtMs: now,
      baseMint: cfg.assets.baseAssetMint,
      entryBaseAmount: 1n,
      entryTokenAmount: 1n,
      initialTokenAmount: 1n,
      currentTokenAmount: 1n
    });
    repos.createPosition({
      id: "entering",
      mint: "mint-enter",
      mode: "paper",
      status: "ENTERING",
      stage: "FULL",
      sniperMode: false,
      tpStep: 0,
      openedAtMs: now,
      baseMint: cfg.assets.baseAssetMint,
      entryBaseAmount: 1n,
      entryTokenAmount: 1n,
      initialTokenAmount: 1n,
      currentTokenAmount: 1n
    } as any);

    expect(repos.countOpenPositions()).toBe(2);
    expect(repos.getOpenPositions().map((p) => p.id).sort()).toEqual(["exiting", "open"]);
    expect(repos.getOpenPositionByMint("mint-exit")?.id).toBe("exiting");

    const changed = repos.normalizeTransientPositionStates();
    expect(changed).toBe(1);
    expect(repos.getOpenPositionByMint("mint-enter")?.status).toBe("OPEN");

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("persists zero bigint fields during position updates", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oclay-repos-zero-"));
    const dbPath = path.join(dir, "test.sqlite");
    const db = openSqlite(dbPath);
    runMigrations(db);
    const repos = createRepos(db);
    const cfg = loadAppConfig("config/default.json");
    const now = Date.now();

    repos.createPosition({
      id: "flat-me",
      mint: "mint-flat",
      mode: "paper",
      status: "OPEN",
      stage: "FULL",
      sniperMode: false,
      tpStep: 0,
      openedAtMs: now,
      baseMint: cfg.assets.baseAssetMint,
      entryBaseAmount: 1n,
      entryTokenAmount: 5n,
      initialTokenAmount: 5n,
      currentTokenAmount: 5n
    });

    repos.updatePosition({
      id: "flat-me",
      status: "CLOSED",
      closedAtMs: now + 1,
      currentTokenAmount: 0n,
      exitBaseAmount: 0n
    } as any);

    const updated = repos.getPositionById("flat-me");
    expect(updated?.status).toBe("CLOSED");
    expect(updated?.currentTokenAmount).toBe(0n);
    expect(updated?.exitBaseAmount).toBe(0n);

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
