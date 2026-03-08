import { describe, expect, test } from "vitest";
import { renderCompactSummary, renderDashboard } from "../../src/dashboard/render";
import type { DashboardSnapshot } from "../../src/dashboard/types";

function sampleSnapshot(): DashboardSnapshot {
  return {
    meta: {
      mode: "paper",
      startedAtMs: 0,
      nowMs: 10_000,
      uptimeSec: 10,
      refreshSec: 2,
      dbPath: "data/oclay.sqlite"
    },
    counts: {
      tokens: 12,
      tokenSnapshots: 24,
      riskReports: 9,
      openPositions: 1,
      closedPositions: 2,
      executions: 3,
      failedExecutions: 1,
      activeBlocks: 1
    },
    activity: {
      reportsLast1m: 5,
      executionsLast5m: 2
    },
    recentReports: [
      {
        createdAtMs: 9_500,
        mint: "ABCDEF1234567890mint",
        riskScore: 42,
        tradeScore: -10,
        flags: ["LOW_LIQUIDITY", "LOW_VOLUME"]
      }
    ],
    openPositions: [
      {
        id: "pos-1",
        mint: "XYZXYZ1234567890mint",
        status: "OPEN",
        openedAtMs: 9_000,
        entryBaseAmount: "1000000000",
        entryTokenAmount: "250000000",
        entryPriceUsd: 0.01234,
        maxSeenPriceUsd: 0.01567
      }
    ],
    recentExecutions: [
      {
        requestedAtMs: 9_800,
        side: "BUY",
        mint: "XYZXYZ1234567890mint",
        ok: false,
        inAmount: "100000000",
        outAmount: undefined,
        err: "sim failed"
      }
    ],
    activeBlocks: [
      {
        mint: "BLOCK1234567890mint",
        reason: "probe_failed",
        expiresAtMs: 60_000
      }
    ],
    health: {
      staleRiskData: false
    },
    alerts: [
      {
        severity: "CRITICAL",
        code: "JUP_429",
        mint: "XYZXYZ1234567890mint",
        count: 2,
        lastSeenAtMs: 9_900,
        summary: "Jupiter rate limited execution",
        retryAtMs: 12_000
      }
    ],
    sell429: {
      globalCooldownUntilMs: 20_000,
      globalActive: true,
      perMint: [
        {
          mint: "XYZXYZ1234567890mint",
          streak: 2,
          cooldownUntilMs: 12_000
        }
      ]
    },
    streamHealth: {
      enabled: true,
      connected: true,
      stale: false,
      fallbackActive: false,
      lastEventAtMs: 9_990
    },
    capital: {
      pendingReservedEntryUsd: 1.25,
      baseAssetUsdPrice: 200,
      baseAssetUsdPriceAtMs: 9_980,
      realizedPnlUsd: -2,
      unrealizedPnlUsd: 1.5,
      deployedUsd: 12,
      dailyDrawdownUsd: 0.5
    },
    mintRollups: [
      {
        mint: "XYZXYZ1234567890mint",
        hasActivePosition: true,
        activePositionStatus: "OPEN",
        lastActionSide: "BUY",
        lastActionAtMs: 9_800,
        wins24h: 1,
        losses24h: 0,
        failedSells5m: 1,
        routeOk: true
      }
    ],
    focus: {
      mint: "XYZXYZ1234567890mint",
      reason: "open_position",
      risk: {
        createdAtMs: 9_500,
        mint: "ABCDEF1234567890mint",
        riskScore: 42,
        tradeScore: -10,
        flags: ["LOW_LIQUIDITY", "LOW_VOLUME"]
      },
      position: {
        id: "pos-1",
        mint: "XYZXYZ1234567890mint",
        status: "OPEN",
        openedAtMs: 9_000,
        entryBaseAmount: "1000000000",
        entryTokenAmount: "250000000",
        entryPriceUsd: 0.01234,
        maxSeenPriceUsd: 0.01567
      },
      execution: {
        requestedAtMs: 9_800,
        side: "BUY",
        mint: "XYZXYZ1234567890mint",
        ok: false,
        inAmount: "100000000",
        outAmount: undefined,
        err: "sim failed",
        routerPath: "jupiter_fallback"
      }
    }
  };
}

describe("dashboard render", () => {
  test("renders deterministic sections", () => {
    const text = renderDashboard(sampleSnapshot(), { width: 120 });
    expect(text).toContain("Oclay PAPER Dashboard");
    expect(text).toContain("Recent Risk Reports");
    expect(text).toContain("Open Positions");
    expect(text).toContain("Recent Executions");
    expect(text).toContain("Active Blocks");
    expect(text).toContain("Alerts (Critical)");
    expect(text).toContain("Sell 429 Breaker");
    expect(text).toContain("Stream Health");
    expect(text).toContain("Mint Rollups");
    expect(text).toContain("LOW_LIQUIDITY,LOW_VOLUME");
    expect(text).toContain("probe_failed");
  });

  test("renders explicit none rows for empty sections", () => {
    const s = sampleSnapshot();
    s.recentReports = [];
    s.openPositions = [];
    s.recentExecutions = [];
    s.activeBlocks = [];
    s.alerts = [];
    s.mintRollups = [];
    s.focus = null;

    const text = renderDashboard(s, { width: 90 });
    expect(text).toContain("Recent Risk Reports");
    expect(text).toContain("none");
  });

  test("renders compact summary", () => {
    const text = renderCompactSummary(sampleSnapshot(), "read error");
    expect(text).toContain("mode=paper");
    expect(text).toContain("tokens=12");
    expect(text).toContain("alerts=1");
    expect(text).toContain("warning=read error");
  });
});
