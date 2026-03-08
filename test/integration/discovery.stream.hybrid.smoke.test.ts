import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadAppConfig } from "../../src/config/loadConfig";
import { openSqlite } from "../../src/storage/sqlite";
import { runMigrations } from "../../src/storage/migrations";
import { createRepos } from "../../src/storage/repos";
import { startStreamDiscovery } from "../../src/discovery/streamDiscovery";

describe("integration: discovery stream hybrid smoke", () => {
  test("classifies stream event and emits candidate", async () => {
    const cfg = loadAppConfig("config/default.json");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oclay-stream-smoke-"));
    const dbPath = path.join(dir, "test.sqlite");
    const db = openSqlite(dbPath);
    runMigrations(db);
    const repos = createRepos(db);

    const rpc: any = {
      getTransactionWithRetry: async () => ({
        transaction: {
          message: {
            accountKeys: [
              "CPMMoo8L3F4NbTegBCKVNfS2bY2Gb5j2qWQY3X2Y9E7",
              "acct1",
              "acct2",
              "acct3",
              "acct4",
              "acct5",
              "acct6",
              "acct7",
              "acct8"
            ],
            instructions: [{ programIdIndex: 0, accounts: [1, 2, 3, 4, 5, 6, 7, 8], data: "A" }]
          }
        },
        meta: {
          preTokenBalances: [
            {
              mint: "HdpQz8Q9Jfp8hR8bEjjM37fQ38sZ4N2VN6i393XWmM9n",
              accountIndex: 1,
              uiTokenAmount: { amount: "1000" }
            },
            {
              mint: "So11111111111111111111111111111111111111112",
              accountIndex: 2,
              uiTokenAmount: { amount: "900" }
            }
          ],
          postTokenBalances: [
            {
              mint: "HdpQz8Q9Jfp8hR8bEjjM37fQ38sZ4N2VN6i393XWmM9n",
              accountIndex: 1,
              uiTokenAmount: { amount: "900" }
            },
            {
              mint: "So11111111111111111111111111111111111111112",
              accountIndex: 2,
              uiTokenAmount: { amount: "1000" }
            }
          ]
        }
      })
    };

    const stream: any = {
      async start(_programIds: string[], onEvent: (evt: any) => void) {
        onEvent({
          programId: "CPMMoo8L3F4NbTegBCKVNfS2bY2Gb5j2qWQY3X2Y9E7",
          signature: "sig-smoke",
          slot: 1,
          logs: ["Program log: swap"],
          atMs: Date.now()
        });
      },
      async stop() {
        return;
      }
    };

    const candidates: Array<{ mint: string; candidateId: string }> = [];
    const abort = new AbortController();

    const handle = await startStreamDiscovery({
      cfg,
      rpc,
      stream,
      repos,
      logger: { info: () => undefined, warn: () => undefined, debug: () => undefined } as any,
      handlers: {
        onCandidate: (c) => candidates.push({ mint: c.mint, candidateId: c.candidateId })
      },
      stopSignal: abort.signal
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.candidateId).toBeTruthy();
    expect(candidates[0]?.mint).toBe("HdpQz8Q9Jfp8hR8bEjjM37fQ38sZ4N2VN6i393XWmM9n");
    expect(handle.lastEventAtMs()).toBeGreaterThan(0);

    abort.abort();
    await handle.stop();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
