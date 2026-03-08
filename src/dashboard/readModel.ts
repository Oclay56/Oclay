import type { SqliteDb } from "../storage/sqlite";
import type {
  DashboardAlertRow,
  DashboardDecisionKind,
  DashboardDecisionRow,
  DashboardExecutionRow,
  DashboardFocusPanel,
  DashboardMintRollupRow,
  DashboardSnapshot,
  ReadDashboardSnapshotParams
} from "./types";
import { deriveWorkflowPhaseFromPosition, inferWorkflowPhaseFromLifecycle } from "../domain/workflowPhase";

const CRITICAL_RISK_FLAGS = new Set([
  "EXIT_ROUTE_GONE",
  "LIQUIDITY_DRAIN",
  "SUPPLY_INCREASED",
  "PROBE_FAILED"
]);

const ROUTE_BAD_FLAGS = new Set(["NO_EXIT_ROUTE", "EXIT_ROUTE_GONE"]);

export function readDashboardSnapshot(db: SqliteDb, params: ReadDashboardSnapshotParams): DashboardSnapshot {
  const nowMs = params.nowMs;
  const rows = Math.max(1, Math.floor(params.rows));
  const latencyWindowMinutes = Math.max(1, Math.floor(params.latencyWindowMinutes ?? 60));
  const leaderboardLimit = Math.max(1, Math.floor(params.leaderboardLimit ?? 3));
  const alertsWindowMin = Math.max(1, Math.floor(params.alertsWindowMin ?? 15));
  const rollupWindowMin = Math.max(1, Math.floor(params.rollupWindowMin ?? 60));
  const onlyFailures = Boolean(params.onlyFailures);
  const hideSuccess = onlyFailures ? true : Boolean(params.hideSuccess);

  const counts = {
    tokens: countTable(db, "tokens"),
    tokenSnapshots: countTable(db, "token_snapshots"),
    riskReports: countTable(db, "risk_reports"),
    openPositions: countWhere(db, "positions", "status IN ('OPEN','EXITING')"),
    closedPositions: countWhere(db, "positions", "status='CLOSED'"),
    executions: countTable(db, "executions"),
    failedExecutions: countWhere(db, "executions", "ok=0"),
    activeBlocks: countWhereWithParam(db, "blocks", "expires_at > ?", nowMs)
  };

  const activity = {
    reportsLast1m: countWhereWithParam(db, "risk_reports", "created_at >= ?", nowMs - 60_000),
    executionsLast5m: countWhereWithParam(db, "executions", "requested_at >= ?", nowMs - 5 * 60_000)
  };

  const recentReports = db
    .prepare(
      `
      SELECT created_at, mint, risk_score, trade_score, flags_json
      FROM risk_reports
      ORDER BY created_at DESC
      LIMIT ?;
      `
    )
    .all(rows)
    .map((r: any) => ({
      createdAtMs: Number(r.created_at),
      mint: String(r.mint),
      riskScore: Number(r.risk_score),
      tradeScore: Number(r.trade_score),
      flags: safeParseFlags(r.flags_json)
    }));

  const openPositions = db
    .prepare(
      `
      SELECT id, mint, status, stage, opened_at, entry_base_amount, entry_token_amount, entry_price_usd, max_seen_price_usd
      FROM positions
      WHERE status IN ('OPEN','EXITING')
      ORDER BY opened_at DESC
      LIMIT ?;
      `
    )
    .all(rows)
    .map((r: any) => ({
      id: String(r.id),
      mint: String(r.mint),
      status: String(r.status),
      workflowPhase: deriveWorkflowPhaseFromPosition({ status: r.status, stage: r.stage }),
      openedAtMs: Number(r.opened_at),
      entryBaseAmount: String(r.entry_base_amount),
      entryTokenAmount: String(r.entry_token_amount),
      entryPriceUsd: r.entry_price_usd === null ? undefined : Number(r.entry_price_usd),
      maxSeenPriceUsd: r.max_seen_price_usd === null ? undefined : Number(r.max_seen_price_usd)
    }));

  const recentExecutions = readRecentExecutions(db, rows, hideSuccess);
  const recentDecisions = readRecentDecisions(db, rows);

  const activeBlocks = db
    .prepare(
      `
      SELECT mint, reason, expires_at
      FROM blocks
      WHERE expires_at > ?
      ORDER BY expires_at ASC
      LIMIT ?;
      `
    )
    .all(nowMs, rows)
    .map((r: any) => ({
      mint: String(r.mint),
      reason: String(r.reason),
      expiresAtMs: Number(r.expires_at)
    }));

  const latestRiskAtRow = db
    .prepare(
      `
      SELECT created_at
      FROM risk_reports
      ORDER BY created_at DESC
      LIMIT 1;
      `
    )
    .get() as any;
  const latestRiskAtMs = latestRiskAtRow ? Number(latestRiskAtRow.created_at) : 0;
  const staleRiskData = latestRiskAtMs <= 0 || nowMs - latestRiskAtMs > params.refreshSec * 2_000;
  const latency = computeLatencyStats(db, latencyWindowMinutes, nowMs);
  const leaderboard = computeLeaderboard(db, leaderboardLimit, nowMs);

  const runtimeSell429 = params.runtimeState?.sell429;
  const sell429 = {
    globalCooldownUntilMs: runtimeSell429?.globalCooldownUntilMs,
    globalActive:
      runtimeSell429?.globalCooldownUntilMs !== undefined &&
      runtimeSell429.globalCooldownUntilMs > nowMs,
    perMint: (runtimeSell429?.perMint ?? [])
      .filter((x) => x.cooldownUntilMs > nowMs)
      .sort((a, b) => b.cooldownUntilMs - a.cooldownUntilMs)
      .slice(0, Math.min(rows, 8))
      .map((x) => ({
        mint: x.mint,
        streak: x.streak,
        cooldownUntilMs: x.cooldownUntilMs
      }))
  };

  const streamHealth = {
    enabled: params.runtimeState?.stream?.enabled ?? false,
    connected: params.runtimeState?.stream?.connected ?? false,
    stale: params.runtimeState?.stream?.stale ?? false,
    fallbackActive: params.runtimeState?.stream?.fallbackActive ?? false,
    lastEventAtMs: params.runtimeState?.stream?.lastEventAtMs
  };

  const runtimeCapital = params.runtimeState?.capital;
  const capital = {
    pendingReservedEntryUsd: finiteOrUndefined(runtimeCapital?.pendingReservedEntryUsd),
    baseAssetUsdPrice: finiteOrUndefined(runtimeCapital?.baseAssetUsdPrice),
    baseAssetUsdPriceAtMs: runtimeCapital?.baseAssetUsdPriceAtMs,
    walletSolBalance: finiteOrUndefined(runtimeCapital?.walletSolBalance),
    walletUsdBalance: finiteOrUndefined(runtimeCapital?.walletUsdBalance),
    walletBalanceAtMs: runtimeCapital?.walletBalanceAtMs,
    realizedPnlUsd: finiteOrUndefined(runtimeCapital?.realizedPnlUsd),
    unrealizedPnlUsd: finiteOrUndefined(runtimeCapital?.unrealizedPnlUsd),
    deployedUsd: finiteOrUndefined(runtimeCapital?.deployedUsd),
    dailyDrawdownUsd: finiteOrUndefined(runtimeCapital?.dailyDrawdownUsd)
  };

  const alerts = computeAlerts(db, {
    nowMs,
    windowMinutes: alertsWindowMin,
    rows,
    sell429
  });

  const mintRollups = computeMintRollups(db, {
    nowMs,
    windowMinutes: rollupWindowMin,
    rows
  });

  const focus = selectFocusPanel({
    focusMint: params.focusMint,
    openPositions,
    recentExecutions,
    recentReports,
    activeBlocks,
    sell429,
    onlyFailures,
    db
  });

  return {
    meta: {
      mode: params.mode,
      startedAtMs: params.startedAtMs,
      nowMs,
      uptimeSec: Math.max(0, Math.floor((nowMs - params.startedAtMs) / 1000)),
      refreshSec: params.refreshSec,
      dbPath: params.dbPath
    },
    counts,
    activity,
    recentReports,
    openPositions,
    recentExecutions,
    recentDecisions,
    activeBlocks,
    health: {
      staleRiskData
    },
    latency,
    leaderboard,
    alerts,
    sell429,
    streamHealth,
    capital,
    mintRollups,
    focus
  };
}

function readRecentExecutions(db: SqliteDb, rows: number, failuresOnly: boolean): DashboardExecutionRow[] {
  const where = failuresOnly ? "WHERE ok=0" : "";
  return db
    .prepare(
      `
      SELECT requested_at, side, mint, ok, in_amount, out_amount, err, raw_json
      FROM executions
      ${where}
      ORDER BY requested_at DESC
      LIMIT ?;
      `
    )
    .all(rows)
    .map((r: any) => ({
      requestedAtMs: Number(r.requested_at),
      side: String(r.side) === "SELL" ? ("SELL" as const) : ("BUY" as const),
      mint: String(r.mint),
      ok: Number(r.ok) === 1,
      inAmount: r.in_amount === null ? undefined : String(r.in_amount),
      outAmount: r.out_amount === null ? undefined : String(r.out_amount),
      err: r.err === null ? undefined : String(r.err),
      routerPath: deriveRouterPath(String(r.side), r.raw_json)
    }));
}

function readRecentDecisions(db: SqliteDb, rows: number): DashboardDecisionRow[] {
  const lifecycleStages = [
    "ANALYZE_SKIPPED",
    "CANDIDATE_SUPPRESSED",
    "ENTRY_REJECTED",
    "ENTRY_BLOCKED",
    "ENTRY_DISABLED",
    "INTENT_CREATED",
    "SCALE_READY",
    "SCALE_REJECTED",
    "SCALE_BLOCKED"
  ];
  const placeholders = lifecycleStages.map(() => "?").join(", ");
  const rawRows = db
    .prepare(
      `
      SELECT at_ms, mint, stage, candidate_id, position_id, intent_id, meta_json
      FROM trade_lifecycle_events
      WHERE stage IN (${placeholders})
      ORDER BY at_ms DESC
      LIMIT ?;
      `
    )
    .all(...lifecycleStages, Math.max(rows * 6, 24)) as Array<{
    at_ms: number;
    mint: string;
    stage: string;
    candidate_id: string | null;
    position_id: string | null;
    intent_id: string | null;
    meta_json: string | null;
  }>;

  return rawRows
    .map((row) => {
      const meta = safeParseJsonObject(row.meta_json) ?? {};
      const stage = String(row.stage);
      return {
        atMs: Number(row.at_ms),
        mint: String(row.mint),
        stage,
        workflowPhase: inferWorkflowPhaseFromLifecycle({ stage, meta }),
        decisionKind: classifyDecisionKind(stage, meta),
        reason: decisionReason(stage, meta),
        candidateId: normalizeText(row.candidate_id),
        positionId: normalizeText(row.position_id),
        intentId: normalizeText(row.intent_id),
        intentKind: normalizeText(meta.intentKind)
      };
    })
    .filter((row) => row.reason || row.decisionKind !== "INFO")
    .slice(0, rows);
}

function computeAlerts(
  db: SqliteDb,
  params: {
    nowMs: number;
    windowMinutes: number;
    rows: number;
    sell429: { globalCooldownUntilMs?: number; perMint: Array<{ mint: string; cooldownUntilMs: number }> };
  }
): DashboardAlertRow[] {
  const sinceMs = params.nowMs - params.windowMinutes * 60_000;
  const dedupe = new Map<string, DashboardAlertRow>();
  const retryByMint = new Map<string, number>(
    params.sell429.perMint.map((x) => [x.mint, x.cooldownUntilMs])
  );

  const failedExecs = db
    .prepare(
      `
      SELECT mint, side, err, requested_at
      FROM executions
      WHERE ok=0 AND requested_at >= ?
      ORDER BY requested_at DESC
      LIMIT 2000;
      `
    )
    .all(sinceMs) as Array<{ mint: string; side: string; err: string | null; requested_at: number }>;

  for (const row of failedExecs) {
    const classified = classifyExecutionAlert(row.side, row.err);
    if (!classified) continue;
    const key = `${classified.code}:${row.mint}`;
    const current = dedupe.get(key);
    const retryAtMs =
      classified.code === "JUP_429"
        ? retryByMint.get(String(row.mint)) ?? params.sell429.globalCooldownUntilMs
        : undefined;
    if (!current) {
      dedupe.set(key, {
        severity: "CRITICAL",
        code: classified.code,
        mint: String(row.mint),
        count: 1,
        lastSeenAtMs: Number(row.requested_at),
        summary: classified.summary,
        retryAtMs
      });
      continue;
    }
    current.count += 1;
    if (Number(row.requested_at) > current.lastSeenAtMs) current.lastSeenAtMs = Number(row.requested_at);
    if (retryAtMs && (!current.retryAtMs || retryAtMs > current.retryAtMs)) current.retryAtMs = retryAtMs;
  }

  const recentRisks = db
    .prepare(
      `
      SELECT mint, created_at, flags_json
      FROM risk_reports
      WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT 3000;
      `
    )
    .all(sinceMs) as Array<{ mint: string; created_at: number; flags_json: string }>;

  for (const row of recentRisks) {
    const flags = safeParseFlags(row.flags_json).filter((f) => CRITICAL_RISK_FLAGS.has(f));
    for (const flag of flags) {
      const key = `${flag}:${row.mint}`;
      const current = dedupe.get(key);
      if (!current) {
        dedupe.set(key, {
          severity: "CRITICAL",
          code: flag,
          mint: String(row.mint),
          count: 1,
          lastSeenAtMs: Number(row.created_at),
          summary: `critical_risk_flag:${flag}`
        });
        continue;
      }
      current.count += 1;
      if (Number(row.created_at) > current.lastSeenAtMs) current.lastSeenAtMs = Number(row.created_at);
    }
  }

  return [...dedupe.values()]
    .sort((a, b) => {
      const s = severityRank(b.severity) - severityRank(a.severity);
      if (s !== 0) return s;
      if (b.lastSeenAtMs !== a.lastSeenAtMs) return b.lastSeenAtMs - a.lastSeenAtMs;
      return b.count - a.count;
    })
    .slice(0, params.rows);
}

function classifyExecutionAlert(side: string, err: string | null): { code: string; summary: string } | null {
  const msg = String(err ?? "").toLowerCase();
  if (!msg) return null;
  if ((msg.includes("429") || msg.includes("rate limit")) && (msg.includes("jupiter") || msg.includes("ultra"))) {
    return { code: "JUP_429", summary: "Jupiter rate limited execution" };
  }
  if (msg.includes("reconcile_failed") || msg.includes("post_send_uncertain")) {
    return { code: "RECONCILE_FAIL_CLOSED", summary: "Fail-closed reconcile prevented execution truth drift" };
  }
  if (String(side).toUpperCase() === "SELL") {
    return { code: "EXIT_EXEC_FAILURE", summary: "Sell/exit execution failed" };
  }
  return null;
}

function computeMintRollups(
  db: SqliteDb,
  params: { nowMs: number; windowMinutes: number; rows: number }
): DashboardMintRollupRow[] {
  const sinceMs = params.nowMs - params.windowMinutes * 60_000;
  const failedSellSinceMs = params.nowMs - 5 * 60_000;
  const closedSinceMs = params.nowMs - 24 * 60 * 60 * 1000;

  const activeRows = db
    .prepare(
      `
      SELECT mint, status
      FROM positions
      WHERE status IN ('OPEN','EXITING')
      ORDER BY opened_at DESC;
      `
    )
    .all() as Array<{ mint: string; status: string }>;
  const activeByMint = new Map<string, string>();
  for (const row of activeRows) {
    if (!activeByMint.has(String(row.mint))) activeByMint.set(String(row.mint), String(row.status));
  }

  const executionRows = db
    .prepare(
      `
      SELECT mint, side, ok, requested_at
      FROM executions
      WHERE requested_at >= ?
      ORDER BY requested_at DESC
      LIMIT 5000;
      `
    )
    .all(sinceMs) as Array<{ mint: string; side: "BUY" | "SELL"; ok: number; requested_at: number }>;

  const roll = new Map<
    string,
    {
      mint: string;
      lastActionSide?: "BUY" | "SELL";
      lastActionAtMs?: number;
      failedSells5m: number;
      wins24h: number;
      losses24h: number;
      routeOk: boolean;
    }
  >();

  for (const row of executionRows) {
    const mint = String(row.mint);
    const rec = roll.get(mint) ?? {
      mint,
      failedSells5m: 0,
      wins24h: 0,
      losses24h: 0,
      routeOk: true
    };
    if (rec.lastActionAtMs === undefined) {
      rec.lastActionAtMs = Number(row.requested_at);
      rec.lastActionSide = String(row.side) === "SELL" ? "SELL" : "BUY";
    }
    if (String(row.side) === "SELL" && Number(row.ok) !== 1 && Number(row.requested_at) >= failedSellSinceMs) {
      rec.failedSells5m += 1;
    }
    roll.set(mint, rec);
  }

  const closedRows = db
    .prepare(
      `
      SELECT mint, pnl_usd
      FROM positions
      WHERE status='CLOSED' AND closed_at >= ?
      ORDER BY closed_at DESC
      LIMIT 5000;
      `
    )
    .all(closedSinceMs) as Array<{ mint: string; pnl_usd: number | null }>;
  for (const row of closedRows) {
    const mint = String(row.mint);
    const rec = roll.get(mint) ?? {
      mint,
      failedSells5m: 0,
      wins24h: 0,
      losses24h: 0,
      routeOk: true
    };
    const pnl = Number(row.pnl_usd ?? 0);
    if (pnl > 0) rec.wins24h += 1;
    if (pnl < 0) rec.losses24h += 1;
    roll.set(mint, rec);
  }

  const latestRiskRows = db
    .prepare(
      `
      SELECT rr.mint, rr.flags_json
      FROM risk_reports rr
      INNER JOIN (
        SELECT mint, MAX(created_at) AS max_created
        FROM risk_reports
        GROUP BY mint
      ) latest
      ON rr.mint = latest.mint AND rr.created_at = latest.max_created
      LIMIT 5000;
      `
    )
    .all() as Array<{ mint: string; flags_json: string }>;
  for (const row of latestRiskRows) {
    const mint = String(row.mint);
    const rec = roll.get(mint) ?? {
      mint,
      failedSells5m: 0,
      wins24h: 0,
      losses24h: 0,
      routeOk: true
    };
    const flags = safeParseFlags(row.flags_json);
    rec.routeOk = !flags.some((f) => ROUTE_BAD_FLAGS.has(f));
    roll.set(mint, rec);
  }

  for (const [mint, status] of activeByMint.entries()) {
    const rec = roll.get(mint) ?? {
      mint,
      failedSells5m: 0,
      wins24h: 0,
      losses24h: 0,
      routeOk: true
    };
    roll.set(mint, rec);
    activeByMint.set(mint, status);
  }

  return [...roll.values()]
    .map((r) => ({
      mint: r.mint,
      hasActivePosition: activeByMint.has(r.mint),
      activePositionStatus: activeByMint.get(r.mint),
      lastActionSide: r.lastActionSide,
      lastActionAtMs: r.lastActionAtMs,
      wins24h: r.wins24h,
      losses24h: r.losses24h,
      failedSells5m: r.failedSells5m,
      routeOk: r.routeOk
    }))
    .sort((a, b) => {
      const activeDelta = Number(b.hasActivePosition) - Number(a.hasActivePosition);
      if (activeDelta !== 0) return activeDelta;
      if (b.failedSells5m !== a.failedSells5m) return b.failedSells5m - a.failedSells5m;
      return (b.lastActionAtMs ?? 0) - (a.lastActionAtMs ?? 0);
    })
    .slice(0, params.rows);
}

function selectFocusPanel(params: {
  focusMint?: string;
  openPositions: DashboardSnapshot["openPositions"];
  recentExecutions: DashboardSnapshot["recentExecutions"];
  recentReports: DashboardSnapshot["recentReports"];
  activeBlocks: DashboardSnapshot["activeBlocks"];
  sell429: DashboardSnapshot["sell429"];
  onlyFailures: boolean;
  db: SqliteDb;
}): DashboardFocusPanel | null {
  const {
    focusMint,
    openPositions,
    recentExecutions,
    recentReports,
    activeBlocks,
    sell429,
    onlyFailures,
    db
  } = params;

  const universe = new Set<string>();
  for (const r of openPositions) universe.add(r.mint);
  for (const r of recentExecutions) universe.add(r.mint);
  for (const r of recentReports) universe.add(r.mint);
  for (const r of activeBlocks) universe.add(r.mint);

  let mint: string | undefined;
  let reason: DashboardFocusPanel["reason"] | undefined;
  if (focusMint && universe.has(focusMint)) {
    mint = focusMint;
    reason = "cli_focus";
  } else if (openPositions[0]?.mint) {
    mint = openPositions[0].mint;
    reason = "open_position";
  } else {
    const failedExecutionRow = db
      .prepare(
        `
        SELECT mint
        FROM executions
        WHERE ok=0
        ORDER BY requested_at DESC
        LIMIT 1;
        `
      )
      .get() as { mint?: string } | undefined;
    if (failedExecutionRow?.mint) {
      mint = String(failedExecutionRow.mint);
      reason = "recent_failure";
    } else if (recentReports[0]?.mint) {
      mint = recentReports[0].mint;
      reason = "latest_risk";
    }
  }

  if (!mint || !reason) return null;

  const executionSource = [...recentExecutions];
  if (!onlyFailures) {
    const latestForMint = db
      .prepare(
        `
        SELECT requested_at, side, mint, ok, in_amount, out_amount, err, raw_json
        FROM executions
        WHERE mint=?
        ORDER BY requested_at DESC
        LIMIT 1;
        `
      )
      .get(mint) as
      | {
          requested_at: number;
          side: string;
          mint: string;
          ok: number;
          in_amount: string | null;
          out_amount: string | null;
          err: string | null;
          raw_json: string | null;
        }
      | undefined;
    if (latestForMint) {
      executionSource.push({
        requestedAtMs: Number(latestForMint.requested_at),
        side: String(latestForMint.side) === "SELL" ? ("SELL" as const) : ("BUY" as const),
        mint: String(latestForMint.mint),
        ok: Number(latestForMint.ok) === 1,
        inAmount: latestForMint.in_amount === null ? undefined : String(latestForMint.in_amount),
        outAmount: latestForMint.out_amount === null ? undefined : String(latestForMint.out_amount),
        err: latestForMint.err === null ? undefined : String(latestForMint.err),
        routerPath: deriveRouterPath(String(latestForMint.side), latestForMint.raw_json)
      });
    }
  }

  return {
    mint,
    reason,
    risk: recentReports.find((r) => r.mint === mint),
    position: openPositions.find((p) => p.mint === mint),
    execution: executionSource.find((e) => e.mint === mint),
    block: activeBlocks.find((b) => b.mint === mint),
    sell429: sell429.perMint.find((m) => m.mint === mint)
  };
}

function deriveRouterPath(side: string, rawJson: unknown): string | undefined {
  const sideNorm = String(side).toUpperCase();
  const raw = safeParseJsonObject(rawJson);
  const router = raw?.router;
  if (router && typeof router === "object" && typeof (router as Record<string, unknown>).entryPath === "string") {
    return String((router as Record<string, unknown>).entryPath);
  }
  if (typeof raw?.entryPath === "string") return String(raw.entryPath);
  if (sideNorm === "SELL") return "jupiter_sell";
  return undefined;
}

function classifyDecisionKind(stage: string, meta: Record<string, unknown>): DashboardDecisionKind {
  switch (String(stage).toUpperCase()) {
    case "ENTRY_REJECTED":
      return "REJECTED";
    case "ENTRY_BLOCKED":
    case "ENTRY_DISABLED":
    case "CANDIDATE_SUPPRESSED":
      return "BLOCKED";
    case "ANALYZE_SKIPPED":
      return "SKIPPED";
    case "SCALE_READY":
    case "SCALE_REJECTED":
    case "SCALE_BLOCKED":
      return "SCALE";
    case "INTENT_CREATED":
      if (String(meta.intentKind).toUpperCase() === "ENTRY_SCALE") return "SCALE";
      return String(meta.type).toUpperCase() === "SELL" ? "EXIT" : "ADMITTED";
    default:
      return "INFO";
  }
}

function decisionReason(stage: string, meta: Record<string, unknown>): string | undefined {
  const explicit = normalizeText(meta.reason);
  if (explicit) return explicit;
  if (String(stage).toUpperCase() === "INTENT_CREATED") {
    const intentKind = normalizeText(meta.intentKind);
    if (intentKind) return intentKind;
  }
  return undefined;
}

function safeParseFlags(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x));
  } catch {
    return [];
  }
}

function safeParseJsonObject(raw: unknown): Record<string, any> | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, any>;
  } catch {
    return null;
  }
}

function countTable(db: SqliteDb, table: string): number {
  const row = db.prepare(`SELECT COUNT(1) as c FROM ${table};`).get() as any;
  return Number(row?.c ?? 0);
}

function countWhere(db: SqliteDb, table: string, whereSql: string): number {
  const row = db.prepare(`SELECT COUNT(1) as c FROM ${table} WHERE ${whereSql};`).get() as any;
  return Number(row?.c ?? 0);
}

function countWhereWithParam(db: SqliteDb, table: string, whereSql: string, value: number): number {
  const row = db.prepare(`SELECT COUNT(1) as c FROM ${table} WHERE ${whereSql};`).get(value) as any;
  return Number(row?.c ?? 0);
}

function computeLatencyStats(db: SqliteDb, windowMinutes: number, nowMs: number) {
  const sinceMs = nowMs - windowMinutes * 60_000;
  const rows = db
    .prepare(
      `
      SELECT candidate_id, intent_id, stage, at_ms
      FROM trade_lifecycle_events
      WHERE at_ms >= ? AND stage IN ('DETECTED','INTENT_CREATED','SENT','CONFIRMED')
      ORDER BY at_ms ASC;
      `
    )
    .all(sinceMs) as Array<{ candidate_id: string | null; intent_id: string | null; stage: string; at_ms: number }>;
  const byCandidate = new Map<string, Record<string, number>>();
  const byIntent = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const atMs = Number(r.at_ms);
    const candidateId = r.candidate_id ? String(r.candidate_id) : "";
    if (candidateId) {
      const rec = byCandidate.get(candidateId) ?? {};
      const existing = rec[r.stage];
      if (existing === undefined || atMs < existing) rec[r.stage] = atMs;
      byCandidate.set(candidateId, rec);
    }

    const intentId = r.intent_id ? String(r.intent_id) : "";
    if (intentId) {
      const rec = byIntent.get(intentId) ?? {};
      const existing = rec[r.stage];
      if (existing === undefined || atMs < existing) rec[r.stage] = atMs;
      byIntent.set(intentId, rec);
    }
  }

  const detectToIntent: number[] = [];
  const sentToConfirmed: number[] = [];
  for (const rec of byCandidate.values()) {
    if (rec.DETECTED !== undefined && rec.INTENT_CREATED !== undefined && rec.INTENT_CREATED >= rec.DETECTED) {
      detectToIntent.push(rec.INTENT_CREATED - rec.DETECTED);
    }
  }
  for (const rec of byIntent.values()) {
    if (rec.SENT !== undefined && rec.CONFIRMED !== undefined && rec.CONFIRMED >= rec.SENT) {
      sentToConfirmed.push(rec.CONFIRMED - rec.SENT);
    }
  }

  return {
    mode: "candidate_intent_position" as const,
    sampleSize: Math.max(detectToIntent.length, sentToConfirmed.length),
    detectToIntentSamples: detectToIntent.length,
    sentToConfirmedSamples: sentToConfirmed.length,
    detectToIntentMs: {
      p50: percentile(detectToIntent, 50),
      p95: percentile(detectToIntent, 95)
    },
    sentToConfirmedMs: {
      p50: percentile(sentToConfirmed, 50),
      p95: percentile(sentToConfirmed, 95)
    }
  };
}

function computeLeaderboard(db: SqliteDb, limit: number, nowMs: number) {
  const sinceMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(
      `
      SELECT features_json, pnl_usd
      FROM trade_attribution
      WHERE closed_at >= ?
      ORDER BY closed_at DESC
      LIMIT 10000;
      `
    )
    .all(sinceMs) as Array<{ features_json: string; pnl_usd: number | null }>;
  const buckets = new Map<string, { trades: number; wins: number; totalPnlUsd: number }>();
  for (const r of rows) {
    let key = "unknown";
    try {
      const f = JSON.parse(String(r.features_json ?? "{}")) as any;
      key = String(f.entryPath ?? f.detectSource ?? "unknown");
    } catch {
      key = "unknown";
    }
    const b = buckets.get(key) ?? { trades: 0, wins: 0, totalPnlUsd: 0 };
    b.trades += 1;
    const pnl = Number(r.pnl_usd ?? 0);
    b.totalPnlUsd += Number.isFinite(pnl) ? pnl : 0;
    if (pnl > 0) b.wins += 1;
    buckets.set(key, b);
  }

  return [...buckets.entries()]
    .map(([key, b]) => ({
      key,
      trades: b.trades,
      winRate: b.trades > 0 ? b.wins / b.trades : 0,
      avgPnlUsd: b.trades > 0 ? b.totalPnlUsd / b.trades : 0,
      totalPnlUsd: b.totalPnlUsd
    }))
    .sort((a, b) => b.totalPnlUsd - a.totalPnlUsd)
    .slice(0, limit);
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  const v = sorted[idx];
  return v === undefined ? null : v;
}

function severityRank(v: DashboardAlertRow["severity"]): number {
  switch (v) {
    case "CRITICAL":
      return 2;
    case "WARN":
      return 1;
    default:
      return 0;
  }
}

function finiteOrUndefined(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return v;
}

function normalizeText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}
