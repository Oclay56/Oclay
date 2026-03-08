import type { AppConfig } from "../config/schema";
import type { RuntimeEnv } from "../config/loadConfig";
import { readDashboardSnapshot } from "../dashboard/readModel";
import type { DashboardSnapshot } from "../dashboard/types";
import type { RiskFlag } from "../domain/flags";
import type { TokenRiskReport } from "../domain/types";
import { deriveWorkflowPhaseFromPosition, type WorkflowPhase } from "../domain/workflowPhase";
import type { RuntimeDashboardState } from "../runtime/dashboardState";
import { createRepos } from "../storage/repos";
import type { SqliteDb } from "../storage/sqlite";
import type { RuntimeHub, WebRuntimeStatusSnapshot } from "./runtimeHub";

const CRITICAL_RISK_FLAGS = new Set([
  "EXIT_ROUTE_GONE",
  "LIQUIDITY_DRAIN",
  "SUPPLY_INCREASED",
  "PROBE_FAILED"
]);

const ROUTE_BAD_FLAGS = new Set(["NO_EXIT_ROUTE", "EXIT_ROUTE_GONE"]);

export interface ApiPosition {
  id: string;
  mint: string;
  mode: "paper" | "live";
  status: string;
  stage?: string;
  workflowPhase: WorkflowPhase;
  openedAtMs: number;
  closedAtMs?: number;
  entryBaseAmount: string;
  entryTokenAmount: string;
  currentTokenAmount?: string;
  initialTokenAmount?: string;
  exitBaseAmount?: string;
  entryTx?: string;
  exitTx?: string;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  maxSeenPriceUsd?: number;
  pnlUsd?: number;
}

export interface ApiExecution {
  requestedAtMs: number;
  executedAtMs?: number;
  side: "BUY" | "SELL";
  mint: string;
  ok: boolean;
  txSig?: string;
  inAmount?: string;
  outAmount?: string;
  err?: string;
  routerPath?: string;
}

export interface ApiBlock {
  mint: string;
  reason: string;
  blockedAtMs?: number;
  expiresAtMs: number;
  active: boolean;
}

export interface ApiMintSnapshot {
  capturedAtMs: number;
  liquidityUsd?: number;
  priceUsd?: number;
}

export interface ApiMintDetail {
  mint: string;
  riskReport: TokenRiskReport | null;
  position: ApiPosition | null;
  execution: ApiExecution | null;
  block: ApiBlock | null;
  snapshot: ApiMintSnapshot | null;
  sell429?: {
    mint: string;
    streak: number;
    cooldownUntilMs: number;
  };
  recentExecutions: ApiExecution[];
  recentReports: TokenRiskReport[];
}

export interface ApiSystemState {
  dbPath: string;
  configPath: string;
  rpcUrl: string;
  rpcConcurrency: number;
  rpcIntervalCap?: number;
  rpcIntervalMs?: number;
  baseAssetUsdPrice?: number;
  baseAssetUsdPriceAtMs?: number;
  liveEnabled: boolean;
  killSwitchActive: boolean;
  heliusPresent: boolean;
  sseConnected: boolean;
  lastHeartbeatAtMs?: number;
  workflowMode: "observe" | "paper" | "live";
  dashboardMode: "paper" | "live";
  botRunning: boolean;
  botStartedAtMs?: number;
  botStoppedAtMs?: number;
  runtimeSubscribers: number;
  dashboardLogLevel: string;
  dashboardLogTarget: "stdout" | "stderr" | "file";
}

export interface ApiStrategyState {
  dbPath: string;
  configPath: string;
  workflowMode: "observe" | "paper" | "live";
  dashboardMode: "paper" | "live";
  liveEnabled: boolean;
  killSwitchActive: boolean;
  assets: AppConfig["assets"];
  discovery: AppConfig["discovery"];
  analysis: AppConfig["analysis"];
  strategy: AppConfig["strategy"];
  execution: AppConfig["execution"];
  probe: AppConfig["probe"];
  paper: AppConfig["paper"];
  guardian: AppConfig["guardian"];
  telemetry: AppConfig["telemetry"];
}

export function readDashboardResponse(params: {
  db: SqliteDb;
  cfg: AppConfig;
  env: RuntimeEnv;
  runtimeState: RuntimeDashboardState;
  runtimeStatus: WebRuntimeStatusSnapshot;
  startedAtMs: number;
  refreshSec: number;
  rows: number;
  hideSuccess?: boolean;
  onlyFailures?: boolean;
  focusMint?: string;
  alertsWindowMin?: number;
  rollupWindowMin?: number;
}): DashboardSnapshot {
  return readDashboardSnapshot(params.db, {
    mode: params.runtimeStatus.dashboardMode,
    startedAtMs: params.startedAtMs,
    nowMs: Date.now(),
    refreshSec: params.refreshSec,
    dbPath: params.env.dbPath,
    rows: params.rows,
    latencyWindowMinutes: params.cfg.telemetry.latencyWindowMinutes,
    leaderboardLimit: Math.max(5, params.rows),
    hideSuccess: params.hideSuccess,
    onlyFailures: params.onlyFailures,
    focusMint: normalizeText(params.focusMint),
    alertsWindowMin: params.alertsWindowMin,
    rollupWindowMin: params.rollupWindowMin,
    runtimeState: params.runtimeState
  });
}

export function readPositions(
  db: SqliteDb,
  params: { status?: string; mint?: string; limit?: number; offset?: number } = {}
): ApiPosition[] {
  const where: string[] = [];
  const values: Array<string | number> = [];

  switch (params.status) {
    case "active":
      where.push("status IN ('OPEN','EXITING')");
      break;
    case "closed":
      where.push("status='CLOSED'");
      break;
    default:
      break;
  }

  const mint = normalizeText(params.mint);
  if (mint) {
    where.push("mint LIKE ?");
    values.push(`%${mint}%`);
  }

  const limit = clampInt(params.limit, 100, 1, 500);
  const offset = clampInt(params.offset, 0, 0, 100_000);
  values.push(limit, offset);

  const sql = `
    SELECT
      id, mint, mode, status, stage, opened_at, closed_at,
      entry_base_amount, entry_token_amount, current_token_amount, initial_token_amount,
      exit_base_amount, entry_tx, exit_tx, entry_price_usd, exit_price_usd,
      max_seen_price_usd, pnl_usd
    FROM positions
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY opened_at DESC
    LIMIT ?
    OFFSET ?;
  `;

  return (db.prepare(sql).all(...values) as any[]).map(mapPositionRow);
}

export function readExecutions(
  db: SqliteDb,
  params: {
    onlyFailures?: boolean;
    hideSuccess?: boolean;
    side?: string;
    mint?: string;
    windowMin?: number;
    limit?: number;
  } = {}
): ApiExecution[] {
  const where: string[] = [];
  const values: Array<string | number> = [];

  if (params.onlyFailures || params.hideSuccess) {
    where.push("ok=0");
  }

  const side = normalizeText(params.side)?.toUpperCase();
  if (side === "BUY" || side === "SELL") {
    where.push("side=?");
    values.push(side);
  }

  const mint = normalizeText(params.mint);
  if (mint) {
    where.push("mint LIKE ?");
    values.push(`%${mint}%`);
  }

  const windowMin = clampInt(params.windowMin, 60, 1, 10_080);
  where.push("requested_at >= ?");
  values.push(Date.now() - windowMin * 60_000);

  const limit = clampInt(params.limit, 200, 1, 1_000);
  values.push(limit);

  const sql = `
    SELECT requested_at, executed_at, side, mint, ok, tx_sig, in_amount, out_amount, err, raw_json
    FROM executions
    WHERE ${where.join(" AND ")}
    ORDER BY requested_at DESC
    LIMIT ?;
  `;

  return (db.prepare(sql).all(...values) as any[]).map((row) => mapExecutionRow(row));
}

export function readRiskReports(
  db: SqliteDb,
  params: { latestPerMint?: boolean; criticalOnly?: boolean; mint?: string; limit?: number } = {}
): TokenRiskReport[] {
  const mint = normalizeText(params.mint);
  const limit = clampInt(params.limit, 100, 1, 1_000);
  let rows: any[];

  if (params.latestPerMint) {
    const values: Array<string | number> = [];
    let innerWhere = "";
    if (mint) {
      innerWhere = "WHERE mint LIKE ?";
      values.push(`%${mint}%`);
    }
    values.push(limit * 4);
    rows = db
      .prepare(
        `
        SELECT rr.mint, rr.created_at, rr.flags_json, rr.risk_score, rr.opportunity_score, rr.trade_score, rr.metrics_json, rr.reasons_json
        FROM risk_reports rr
        INNER JOIN (
          SELECT mint, MAX(created_at) AS max_created
          FROM risk_reports
          ${innerWhere}
          GROUP BY mint
        ) latest
        ON rr.mint = latest.mint AND rr.created_at = latest.max_created
        ORDER BY rr.created_at DESC
        LIMIT ?;
        `
      )
      .all(...values) as any[];
  } else {
    const values: Array<string | number> = [];
    let whereSql = "";
    if (mint) {
      whereSql = "WHERE mint LIKE ?";
      values.push(`%${mint}%`);
    }
    values.push(limit * 4);
    rows = db
      .prepare(
        `
        SELECT mint, created_at, flags_json, risk_score, opportunity_score, trade_score, metrics_json, reasons_json
        FROM risk_reports
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ?;
        `
      )
      .all(...values) as any[];
  }

  const reports = rows.map((row) => mapRiskRow(row));
  return params.criticalOnly
    ? reports.filter((report) => report.flags.some((flag) => CRITICAL_RISK_FLAGS.has(flag))).slice(0, limit)
    : reports.slice(0, limit);
}

export function readBlocks(db: SqliteDb, params: { activeOnly?: boolean } = {}): ApiBlock[] {
  const nowMs = Date.now();
  const values: Array<number> = [];
  let whereSql = "";
  if (params.activeOnly !== false) {
    whereSql = "WHERE expires_at > ?";
    values.push(nowMs);
  }

  const sql = `
    SELECT mint, reason, blocked_at, expires_at
    FROM blocks
    ${whereSql}
    ORDER BY expires_at DESC
    LIMIT 500;
  `;

  return (db.prepare(sql).all(...values) as any[]).map((row) => ({
    mint: String(row.mint),
    reason: String(row.reason),
    blockedAtMs: toOptionalNumber(row.blocked_at),
    expiresAtMs: Number(row.expires_at),
    active: Number(row.expires_at) > nowMs
  }));
}

export function readLatency(db: SqliteDb, windowMin?: number) {
  const repos = createRepos(db);
  return repos.getLatencyStats(clampInt(windowMin, 60, 1, 10_080), "candidate_intent_position");
}

export function readLeaderboard(db: SqliteDb, limit?: number) {
  const repos = createRepos(db);
  return repos.getAttributionLeaderboard(clampInt(limit, 10, 1, 100));
}

export function readMintDetail(
  db: SqliteDb,
  mint: string,
  runtimeState: RuntimeDashboardState
): ApiMintDetail | null {
  const key = normalizeText(mint);
  if (!key) return null;

  const riskRow = db
    .prepare(
      `
      SELECT mint, created_at, flags_json, risk_score, opportunity_score, trade_score, metrics_json, reasons_json
      FROM risk_reports
      WHERE mint=?
      ORDER BY created_at DESC
      LIMIT 1;
      `
    )
    .get(key) as any;

  const positionRow = db
    .prepare(
      `
      SELECT
        id, mint, mode, status, stage, opened_at, closed_at,
        entry_base_amount, entry_token_amount, current_token_amount, initial_token_amount,
        exit_base_amount, entry_tx, exit_tx, entry_price_usd, exit_price_usd,
        max_seen_price_usd, pnl_usd
      FROM positions
      WHERE mint=?
      ORDER BY opened_at DESC
      LIMIT 1;
      `
    )
    .get(key) as any;

  const executionRow = db
    .prepare(
      `
      SELECT requested_at, executed_at, side, mint, ok, tx_sig, in_amount, out_amount, err, raw_json
      FROM executions
      WHERE mint=?
      ORDER BY requested_at DESC
      LIMIT 1;
      `
    )
    .get(key) as any;

  const blockRow = db
    .prepare(
      `
      SELECT mint, reason, blocked_at, expires_at
      FROM blocks
      WHERE mint=?
      ORDER BY expires_at DESC
      LIMIT 1;
      `
    )
    .get(key) as any;

  const snapshotRow = db
    .prepare(
      `
      SELECT captured_at, liquidity_usd, price_usd
      FROM token_snapshots
      WHERE mint=?
      ORDER BY captured_at DESC
      LIMIT 1;
      `
    )
    .get(key) as any;

  const recentExecutionRows = db
    .prepare(
      `
      SELECT requested_at, executed_at, side, mint, ok, tx_sig, in_amount, out_amount, err, raw_json
      FROM executions
      WHERE mint=?
      ORDER BY requested_at DESC
      LIMIT 10;
      `
    )
    .all(key) as any[];

  const recentRiskRows = db
    .prepare(
      `
      SELECT mint, created_at, flags_json, risk_score, opportunity_score, trade_score, metrics_json, reasons_json
      FROM risk_reports
      WHERE mint=?
      ORDER BY created_at DESC
      LIMIT 10;
      `
    )
    .all(key) as any[];

  const nowMs = Date.now();
  const sell429 = runtimeState.sell429?.perMint?.find((entry) => entry.mint === key);

  if (!riskRow && !positionRow && !executionRow && !blockRow && !snapshotRow) {
    return null;
  }

  return {
    mint: key,
    riskReport: riskRow ? mapRiskRow(riskRow) : null,
    position: positionRow ? mapPositionRow(positionRow) : null,
    execution: executionRow ? mapExecutionRow(executionRow) : null,
    block: blockRow
      ? {
          mint: String(blockRow.mint),
          reason: String(blockRow.reason),
          blockedAtMs: toOptionalNumber(blockRow.blocked_at),
          expiresAtMs: Number(blockRow.expires_at),
          active: Number(blockRow.expires_at) > nowMs
        }
      : null,
    snapshot: snapshotRow
      ? {
          capturedAtMs: Number(snapshotRow.captured_at),
          liquidityUsd: toOptionalNumber(snapshotRow.liquidity_usd),
          priceUsd: toOptionalNumber(snapshotRow.price_usd)
        }
      : null,
    sell429: sell429
      ? {
          mint: sell429.mint,
          streak: sell429.streak,
          cooldownUntilMs: sell429.cooldownUntilMs
        }
      : undefined,
    recentExecutions: recentExecutionRows.map((row) => mapExecutionRow(row)),
    recentReports: recentRiskRows.map((row) => mapRiskRow(row))
  };
}

export function readSystemState(params: {
  env: RuntimeEnv;
  runtimeHub: RuntimeHub;
}): ApiSystemState {
  const status = params.runtimeHub.getStatusSnapshot();
  const capital = params.runtimeHub.getRuntimeState().capital;
  return {
    dbPath: params.env.dbPath,
    configPath: params.runtimeHub.getConfigPath(),
    rpcUrl: maskRpcUrl(params.env.rpcUrl),
    rpcConcurrency: params.env.rpcConcurrency,
    rpcIntervalCap: params.env.rpcIntervalCap,
    rpcIntervalMs: params.env.rpcIntervalMs,
    baseAssetUsdPrice: capital?.baseAssetUsdPrice,
    baseAssetUsdPriceAtMs: capital?.baseAssetUsdPriceAtMs,
    liveEnabled: params.env.liveTradingEnabled,
    killSwitchActive: params.env.killSwitch,
    heliusPresent: Boolean(params.env.heliusWsUrl),
    sseConnected: status.subscriberCount > 0,
    lastHeartbeatAtMs: status.lastRuntimePatchAtMs,
    workflowMode: status.workflowMode,
    dashboardMode: status.dashboardMode,
    botRunning: status.botRunning,
    botStartedAtMs: status.botStartedAtMs,
    botStoppedAtMs: status.botStoppedAtMs,
    runtimeSubscribers: status.subscriberCount,
    dashboardLogLevel: params.env.dashboardLogLevel,
    dashboardLogTarget: params.env.dashboardLogTarget
  };
}

export function readStrategyState(params: {
  env: RuntimeEnv;
  runtimeHub: RuntimeHub;
}): ApiStrategyState {
  const status = params.runtimeHub.getStatusSnapshot();
  const cfg = params.runtimeHub.getConfig();
  return {
    dbPath: params.env.dbPath,
    configPath: params.runtimeHub.getConfigPath(),
    workflowMode: status.workflowMode,
    dashboardMode: status.dashboardMode,
    liveEnabled: params.env.liveTradingEnabled,
    killSwitchActive: params.env.killSwitch,
    assets: cfg.assets,
    discovery: cfg.discovery,
    analysis: cfg.analysis,
    strategy: cfg.strategy,
    execution: cfg.execution,
    probe: cfg.probe,
    paper: cfg.paper,
    guardian: cfg.guardian,
    telemetry: cfg.telemetry
  };
}

function mapPositionRow(row: any): ApiPosition {
  return {
    id: String(row.id),
    mint: String(row.mint),
    mode: String(row.mode) === "live" ? "live" : "paper",
    status: String(row.status),
    stage: row.stage === null || row.stage === undefined ? undefined : String(row.stage),
    workflowPhase: deriveWorkflowPhaseFromPosition({
      status: row.status,
      stage: row.stage
    }),
    openedAtMs: Number(row.opened_at),
    closedAtMs: toOptionalNumber(row.closed_at),
    entryBaseAmount: String(row.entry_base_amount),
    entryTokenAmount: String(row.entry_token_amount),
    currentTokenAmount:
      row.current_token_amount === null || row.current_token_amount === undefined
        ? undefined
        : String(row.current_token_amount),
    initialTokenAmount:
      row.initial_token_amount === null || row.initial_token_amount === undefined
        ? undefined
        : String(row.initial_token_amount),
    exitBaseAmount: row.exit_base_amount === null ? undefined : String(row.exit_base_amount),
    entryTx: normalizeText(row.entry_tx),
    exitTx: normalizeText(row.exit_tx),
    entryPriceUsd: toOptionalNumber(row.entry_price_usd),
    exitPriceUsd: toOptionalNumber(row.exit_price_usd),
    maxSeenPriceUsd: toOptionalNumber(row.max_seen_price_usd),
    pnlUsd: toOptionalNumber(row.pnl_usd)
  };
}

function mapExecutionRow(row: any): ApiExecution {
  return {
    requestedAtMs: Number(row.requested_at),
    executedAtMs: toOptionalNumber(row.executed_at),
    side: String(row.side) === "SELL" ? "SELL" : "BUY",
    mint: String(row.mint),
    ok: Number(row.ok) === 1,
    txSig: normalizeText(row.tx_sig),
    inAmount: row.in_amount === null ? undefined : String(row.in_amount),
    outAmount: row.out_amount === null ? undefined : String(row.out_amount),
    err: normalizeText(row.err),
    routerPath: deriveRouterPath(String(row.side), row.raw_json)
  };
}

function mapRiskRow(row: any): TokenRiskReport {
  const flags = safeParseStringArray(row.flags_json) as RiskFlag[];
  const metrics = safeParseJsonObject(row.metrics_json);
  const reasons = safeParseStringArray(row.reasons_json);
  const market = asRecord(metrics.market);
  const route = asRecord(metrics.route);
  const holders = asRecord(metrics.holders);
  const quickHolders = asRecord(metrics.quickHolders);

  const top1HolderPct = firstFiniteNumber(holders.top1HolderPct, quickHolders.top1HolderPct);
  const top10HolderPct = firstFiniteNumber(holders.top10HolderPct, quickHolders.top10HolderPct);

  return {
    mint: String(row.mint),
    createdAtMs: Number(row.created_at),
    flags,
    canExitRoute:
      firstBoolean(route.canExitRoute) ??
      !flags.some((flag) => ROUTE_BAD_FLAGS.has(flag)),
    impliedRoundTripLossBps: firstFiniteNumber(route.impliedRoundTripLossBps),
    top1HolderPct,
    top10HolderPct,
    liquidityUsd: firstFiniteNumber(market.liquidityUsd),
    volumeH24Usd: firstFiniteNumber(market.volumeH24Usd),
    marketAgeMinutes: firstFiniteNumber(market.marketAgeMinutes),
    priceImpactPct: firstFiniteNumber(route.priceImpactPct),
    riskScore: Number(row.risk_score),
    opportunityScore: Number(row.opportunity_score),
    tradeScore: Number(row.trade_score),
    reasons,
    metrics
  };
}

function deriveRouterPath(side: string, rawJson: unknown): string | undefined {
  const raw = safeParseJsonObject(rawJson);
  const router = asRecord(raw.router);
  if (typeof router.entryPath === "string") return router.entryPath;
  if (typeof raw.entryPath === "string") return raw.entryPath;
  return String(side).toUpperCase() === "SELL" ? "jupiter_sell" : undefined;
}

function safeParseStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function safeParseJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function toOptionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function maskRpcUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!url.username && !url.password && !url.search) return value;
    url.username = url.username ? "***" : "";
    url.password = url.password ? "***" : "";
    if (url.search) url.search = "";
    return url.toString();
  } catch {
    return value;
  }
}
