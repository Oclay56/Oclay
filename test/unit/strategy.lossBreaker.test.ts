import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openSqlite } from "../../src/storage/sqlite";
import { runMigrations } from "../../src/storage/migrations";
import { createRepos } from "../../src/storage/repos";
import { loadAppConfig } from "../../src/config/loadConfig";
import { getLossBreakerStatus } from "../../src/strategy/lossBreaker";

describe("loss breaker", () => {
  test("blocks entries after configured consecutive losses", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oclay-loss-breaker-"));
    const dbPath = path.join(dir, "test.sqlite");
    const db = openSqlite(dbPath);
    runMigrations(db);
    const repos = createRepos(db);
    const cfg = loadAppConfig("config/default.json");
    const now = Date.now();

    for (let i = 0; i < 3; i++) {
      repos.createPosition({
        id: `p-${i}`,
        mint: `mint-${i}`,
        mode: "paper",
        status: "CLOSED",
        stage: "FULL",
        sniperMode: false,
        tpStep: 0,
        openedAtMs: now - (i + 2) * 60_000,
        closedAtMs: now - i * 60_000,
        baseMint: cfg.assets.baseAssetMint,
        entryBaseAmount: 1_000_000_000n,
        entryTokenAmount: 1_000n,
        initialTokenAmount: 1_000n,
        currentTokenAmount: 0n,
        exitBaseAmount: 900_000_000n,
        pnlUsd: -1
      });
    }

    const status = getLossBreakerStatus({ cfg, repos, mode: "paper", nowMs: now });
    expect(status.blocked).toBe(true);
    expect(status.consecutiveLosses).toBeGreaterThanOrEqual(cfg.strategy.portfolio.consecutiveLossLimit);

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
