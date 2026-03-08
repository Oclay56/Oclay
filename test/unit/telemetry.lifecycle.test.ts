import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openSqlite } from "../../src/storage/sqlite";
import { runMigrations } from "../../src/storage/migrations";
import { createRepos } from "../../src/storage/repos";

describe("telemetry lifecycle latency", () => {
  test("derives detect->intent and sent->confirmed latency windows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oclay-lifecycle-"));
    const dbPath = path.join(dir, "test.sqlite");
    const db = openSqlite(dbPath);
    runMigrations(db);
    const repos = createRepos(db);
    const now = Date.now();

    repos.insertLifecycleEvent({
      id: "1",
      runId: "r",
      candidateId: "cand-a",
      mint: "mint-a",
      stage: "DETECTED",
      atMs: now - 10_000
    });
    repos.insertLifecycleEvent({
      id: "2",
      runId: "r",
      candidateId: "cand-a",
      intentId: "intent-a",
      mint: "mint-a",
      stage: "INTENT_CREATED",
      atMs: now - 8_000
    });
    repos.insertLifecycleEvent({
      id: "3",
      runId: "r",
      candidateId: "cand-a",
      intentId: "intent-a",
      mint: "mint-a",
      stage: "SENT",
      atMs: now - 7_500
    });
    repos.insertLifecycleEvent({
      id: "4",
      runId: "r",
      candidateId: "cand-a",
      intentId: "intent-a",
      mint: "mint-a",
      stage: "CONFIRMED",
      atMs: now - 7_000
    });

    const stats = repos.getLatencyStats(60);
    expect(stats.mode).toBe("candidate_intent_position");
    expect(stats.sampleSize).toBe(1);
    expect(stats.detectToIntentSamples).toBe(1);
    expect(stats.sentToConfirmedSamples).toBe(1);
    expect(stats.detectToIntentMs.p50).toBe(2_000);
    expect(stats.sentToConfirmedMs.p50).toBe(500);

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
