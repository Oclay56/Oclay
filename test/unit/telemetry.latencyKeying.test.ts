import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openSqlite } from "../../src/storage/sqlite";
import { runMigrations } from "../../src/storage/migrations";
import { createRepos } from "../../src/storage/repos";

describe("telemetry latency keying", () => {
  test("uses candidate_id for detect->intent and intent_id for sent->confirmed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oclay-latkey-"));
    const dbPath = path.join(dir, "test.sqlite");
    const db = openSqlite(dbPath);
    runMigrations(db);
    const repos = createRepos(db);
    const now = Date.now();

    const rows = [
      { id: "1", candidateId: "c1", intentId: "i1", stage: "DETECTED", atMs: now - 10_000 },
      { id: "2", candidateId: "c1", intentId: "i1", stage: "INTENT_CREATED", atMs: now - 9_900 },
      { id: "3", candidateId: "c1", intentId: "i1", stage: "SENT", atMs: now - 9_500 },
      { id: "4", candidateId: "c1", intentId: "i1", stage: "CONFIRMED", atMs: now - 9_200 },
      { id: "5", candidateId: "c2", intentId: "i2", stage: "DETECTED", atMs: now - 8_000 },
      { id: "6", candidateId: "c2", intentId: "i2", stage: "INTENT_CREATED", atMs: now - 7_700 },
      { id: "7", candidateId: "c2", intentId: "i2", stage: "SENT", atMs: now - 7_500 },
      { id: "8", candidateId: "c2", intentId: "i2", stage: "CONFIRMED", atMs: now - 7_000 }
    ];
    for (const r of rows) {
      repos.insertLifecycleEvent({
        id: r.id,
        runId: "run",
        candidateId: r.candidateId,
        mint: "same-mint",
        intentId: r.intentId,
        stage: r.stage,
        atMs: r.atMs
      });
    }

    const stats = repos.getLatencyStats(60);
    expect(stats.mode).toBe("candidate_intent_position");
    expect(stats.detectToIntentSamples).toBe(2);
    expect(stats.sentToConfirmedSamples).toBe(2);
    expect(stats.detectToIntentMs.p95).toBe(100);
    expect(stats.sentToConfirmedMs.p95).toBe(300);

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
