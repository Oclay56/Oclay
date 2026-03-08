import type { RuntimeDashboardState } from "../runtime/dashboardState";
import type { WorkflowPhase } from "../domain/workflowPhase";

export interface DashboardMeta {
  mode: "paper" | "live";
  startedAtMs: number;
  nowMs: number;
  uptimeSec: number;
  refreshSec: number;
  dbPath: string;
}

export interface DashboardCounts {
  tokens: number;
  tokenSnapshots: number;
  riskReports: number;
  openPositions: number;
  closedPositions: number;
  executions: number;
  failedExecutions: number;
  activeBlocks: number;
}

export interface DashboardActivity {
  reportsLast1m: number;
  executionsLast5m: number;
}

export interface DashboardRiskRow {
  createdAtMs: number;
  mint: string;
  riskScore: number;
  tradeScore: number;
  flags: string[];
}

export interface DashboardPositionRow {
  id: string;
  mint: string;
  status: string;
  workflowPhase: WorkflowPhase;
  openedAtMs: number;
  entryBaseAmount: string;
  entryTokenAmount: string;
  entryPriceUsd?: number;
  maxSeenPriceUsd?: number;
}

export interface DashboardExecutionRow {
  requestedAtMs: number;
  side: "BUY" | "SELL";
  mint: string;
  ok: boolean;
  inAmount?: string;
  outAmount?: string;
  err?: string;
  routerPath?: string;
}

export interface DashboardBlockRow {
  mint: string;
  reason: string;
  expiresAtMs: number;
}

export type DashboardDecisionKind = "ADMITTED" | "REJECTED" | "BLOCKED" | "SKIPPED" | "EXIT" | "SCALE" | "INFO";

export interface DashboardDecisionRow {
  atMs: number;
  mint: string;
  stage: string;
  workflowPhase?: WorkflowPhase;
  decisionKind: DashboardDecisionKind;
  reason?: string;
  candidateId?: string;
  positionId?: string;
  intentId?: string;
  intentKind?: string;
}

export interface DashboardHealth {
  staleRiskData: boolean;
}

export interface DashboardLatency {
  mode: "candidate_intent_position";
  sampleSize: number;
  detectToIntentSamples: number;
  sentToConfirmedSamples: number;
  detectToIntentMs: { p50: number | null; p95: number | null };
  sentToConfirmedMs: { p50: number | null; p95: number | null };
}

export interface DashboardLeaderboardRow {
  key: string;
  trades: number;
  winRate: number;
  avgPnlUsd: number;
  totalPnlUsd: number;
}

export type DashboardAlertSeverity = "CRITICAL" | "WARN";

export interface DashboardAlertRow {
  severity: DashboardAlertSeverity;
  code: string;
  mint: string;
  count: number;
  lastSeenAtMs: number;
  summary: string;
  retryAtMs?: number;
}

export interface DashboardSell429MintRow {
  mint: string;
  streak: number;
  cooldownUntilMs: number;
}

export interface DashboardSell429Panel {
  globalCooldownUntilMs?: number;
  globalActive: boolean;
  perMint: DashboardSell429MintRow[];
}

export interface DashboardStreamHealthPanel {
  enabled: boolean;
  connected: boolean;
  stale: boolean;
  fallbackActive: boolean;
  lastEventAtMs?: number;
}

export interface DashboardCapitalPanel {
  pendingReservedEntryUsd?: number;
  baseAssetUsdPrice?: number;
  baseAssetUsdPriceAtMs?: number;
  walletSolBalance?: number;
  walletUsdBalance?: number;
  walletBalanceAtMs?: number;
  realizedPnlUsd?: number;
  unrealizedPnlUsd?: number;
  deployedUsd?: number;
  dailyDrawdownUsd?: number;
}

export interface DashboardMintRollupRow {
  mint: string;
  hasActivePosition: boolean;
  activePositionStatus?: string;
  lastActionSide?: "BUY" | "SELL";
  lastActionAtMs?: number;
  wins24h: number;
  losses24h: number;
  failedSells5m: number;
  routeOk: boolean;
}

export interface DashboardFocusPanel {
  mint: string;
  reason: "cli_focus" | "open_position" | "recent_failure" | "latest_risk";
  risk?: DashboardRiskRow;
  position?: DashboardPositionRow;
  execution?: DashboardExecutionRow;
  block?: DashboardBlockRow;
  sell429?: DashboardSell429MintRow;
}

export interface DashboardSnapshot {
  meta: DashboardMeta;
  counts: DashboardCounts;
  activity: DashboardActivity;
  recentReports: DashboardRiskRow[];
  openPositions: DashboardPositionRow[];
  recentExecutions: DashboardExecutionRow[];
  recentDecisions: DashboardDecisionRow[];
  activeBlocks: DashboardBlockRow[];
  health: DashboardHealth;
  latency?: DashboardLatency;
  leaderboard?: DashboardLeaderboardRow[];
  alerts: DashboardAlertRow[];
  sell429: DashboardSell429Panel;
  streamHealth: DashboardStreamHealthPanel;
  capital: DashboardCapitalPanel;
  mintRollups: DashboardMintRollupRow[];
  focus: DashboardFocusPanel | null;
}

export interface ReadDashboardSnapshotParams {
  mode: "paper" | "live";
  startedAtMs: number;
  nowMs: number;
  refreshSec: number;
  dbPath: string;
  rows: number;
  latencyWindowMinutes?: number;
  leaderboardLimit?: number;
  hideSuccess?: boolean;
  onlyFailures?: boolean;
  focusMint?: string;
  alertsWindowMin?: number;
  rollupWindowMin?: number;
  runtimeState?: RuntimeDashboardState;
}

export interface DashboardRenderOptions {
  width?: number;
  warning?: string;
}
