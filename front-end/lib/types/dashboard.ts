export type Mode = "paper" | "live";

export type PositionStatus = "OPEN" | "EXITING" | "CLOSED";

export type ExecutionSide = "BUY" | "SELL";

export type AlertSeverity = "CRITICAL" | "WARN";

export type AlertCode = "JUP_429" | "RECONCILE_FAIL_CLOSED" | "EXIT_EXEC_FAILURE";

export type RouterPath = "raydium_direct" | "jupiter_fallback" | "jupiter_only" | "jupiter_sell" | "paper";

export type FocusReason = "cli_focus" | "open_position" | "recent_failure" | "latest_risk";

export type WorkflowPhase =
  | "DISCOVERED"
  | "ANALYZING"
  | "ELIGIBLE"
  | "BLOCKED"
  | "REJECTED"
  | "ENTERING"
  | "SCALING"
  | "MONITORING"
  | "EXITING"
  | "CLOSED";

export type DecisionKind = "ADMITTED" | "REJECTED" | "BLOCKED" | "SKIPPED" | "EXIT" | "SCALE" | "INFO";

export interface StreamState {
  enabled?: boolean;
  connected?: boolean;
  stale?: boolean;
  fallbackActive?: boolean;
  lastEventAtMs?: number;
}

export interface Sell429State {
  globalCooldownUntilMs?: number;
  perMint?: Array<{
    mint: string;
    streak: number;
    cooldownUntilMs: number;
  }>;
}

export interface CapitalState {
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

export interface RuntimeDashboardStatePatch {
  stream?: StreamState;
  sell429?: Sell429State;
  capital?: CapitalState;
}

export interface DashboardMeta {
  mode: Mode;
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

export interface RiskReport {
  createdAtMs: number;
  mint: string;
  riskScore: number;
  tradeScore: number;
  flags: string[];
}

export interface OpenPosition {
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

export interface Execution {
  requestedAtMs: number;
  executedAtMs?: number;
  side: ExecutionSide;
  mint: string;
  ok: boolean;
  txSig?: string;
  inAmount?: string;
  outAmount?: string;
  err?: string;
  routerPath?: RouterPath;
}

export interface ActiveBlock {
  mint: string;
  reason: string;
  expiresAtMs: number;
}

export interface Decision {
  atMs: number;
  mint: string;
  stage: string;
  workflowPhase?: WorkflowPhase;
  decisionKind: DecisionKind;
  reason?: string;
  candidateId?: string;
  positionId?: string;
  intentId?: string;
  intentKind?: string;
}

export interface HealthState {
  staleRiskData: boolean;
}

export interface LatencyMetrics {
  mode: "candidate_intent_position";
  sampleSize: number;
  detectToIntentSamples: number;
  sentToConfirmedSamples: number;
  detectToIntentMs: { p50: number | null; p95: number | null };
  sentToConfirmedMs: { p50: number | null; p95: number | null };
}

export interface LeaderboardEntry {
  key: string;
  trades: number;
  winRate: number;
  avgPnlUsd: number;
  totalPnlUsd: number;
}

export interface Alert {
  severity: AlertSeverity;
  code: AlertCode;
  mint: string;
  count: number;
  lastSeenAtMs: number;
  summary: string;
  retryAtMs?: number;
}

export interface Sell429Display {
  globalCooldownUntilMs?: number;
  globalActive: boolean;
  perMint: Array<{
    mint: string;
    streak: number;
    cooldownUntilMs: number;
  }>;
}

export interface StreamHealth {
  enabled: boolean;
  connected: boolean;
  stale: boolean;
  fallbackActive: boolean;
  lastEventAtMs?: number;
}

export interface MintRollup {
  mint: string;
  hasActivePosition: boolean;
  activePositionStatus?: string;
  lastActionSide?: ExecutionSide;
  lastActionAtMs?: number;
  wins24h: number;
  losses24h: number;
  failedSells5m: number;
  routeOk: boolean;
}

export interface FocusState {
  mint: string;
  reason: FocusReason;
  risk?: RiskReport;
  position?: OpenPosition;
  execution?: Execution;
  block?: ActiveBlock;
  sell429?: {
    mint: string;
    streak: number;
    cooldownUntilMs: number;
  };
}

export interface DashboardSnapshot {
  meta: DashboardMeta;
  counts: DashboardCounts;
  activity: DashboardActivity;
  recentReports: RiskReport[];
  openPositions: OpenPosition[];
  recentExecutions: Execution[];
  recentDecisions: Decision[];
  activeBlocks: ActiveBlock[];
  health: HealthState;
  latency?: LatencyMetrics;
  leaderboard?: LeaderboardEntry[];
  alerts: Alert[];
  sell429: Sell429Display;
  streamHealth: StreamHealth;
  capital: CapitalState;
  mintRollups: MintRollup[];
  focus: FocusState | null;
}

export interface TokenRiskReport {
  mint: string;
  createdAtMs: number;
  flags: string[];
  canExitRoute: boolean;
  impliedRoundTripLossBps?: number;
  top1HolderPct?: number;
  top10HolderPct?: number;
  liquidityUsd?: number;
  volumeH24Usd?: number;
  marketAgeMinutes?: number;
  priceImpactPct?: number;
  riskScore: number;
  opportunityScore: number;
  tradeScore: number;
  reasons: string[];
  metrics: Record<string, unknown>;
}

export interface Position {
  id: string;
  mint: string;
  mode?: Mode;
  status: PositionStatus;
  stage?: string;
  workflowPhase?: WorkflowPhase;
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

export interface SystemState {
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
  dashboardMode: Mode;
  botRunning: boolean;
  botStartedAtMs?: number;
  botStoppedAtMs?: number;
  runtimeSubscribers: number;
  dashboardLogLevel: string;
  dashboardLogTarget: "stdout" | "stderr" | "file";
}

export interface MintDetail {
  mint: string;
  riskReport: TokenRiskReport | null;
  position: Position | null;
  execution: Execution | null;
  block: (ActiveBlock & { blockedAtMs?: number; active?: boolean }) | null;
  snapshot: {
    capturedAtMs: number;
    liquidityUsd?: number;
    priceUsd?: number;
  } | null;
  sell429?: {
    mint: string;
    streak: number;
    cooldownUntilMs: number;
  };
  recentExecutions: Execution[];
  recentReports: TokenRiskReport[];
}

export interface StrategyState {
  dbPath: string;
  configPath: string;
  workflowMode: "observe" | "paper" | "live";
  dashboardMode: Mode;
  liveEnabled: boolean;
  killSwitchActive: boolean;
  assets: Record<string, unknown>;
  discovery: Record<string, unknown>;
  analysis: Record<string, unknown>;
  strategy: Record<string, unknown>;
  execution: Record<string, unknown>;
  probe: Record<string, unknown>;
  paper: Record<string, unknown>;
  guardian: Record<string, unknown>;
  telemetry: Record<string, unknown>;
}
