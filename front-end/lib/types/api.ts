export interface DashboardQueryParams {
  refreshSec?: number;
  rows?: number;
  hideSuccess?: boolean;
  onlyFailures?: boolean;
  focusMint?: string;
  alertsWindowMin?: number;
  rollupWindowMin?: number;
}

export interface PositionsQueryParams {
  status?: "all" | "active" | "closed";
  mint?: string;
  limit?: number;
  offset?: number;
}

export interface ExecutionsQueryParams {
  onlyFailures?: boolean;
  hideSuccess?: boolean;
  side?: "BUY" | "SELL";
  mint?: string;
  windowMin?: number;
}

export interface RiskQueryParams {
  latestPerMint?: boolean;
  criticalOnly?: boolean;
  mint?: string;
  limit?: number;
}

export interface BlocksQueryParams {
  activeOnly?: boolean;
}

export interface LatencyQueryParams {
  windowMin?: number;
}

export interface LeaderboardQueryParams {
  limit?: number;
}

export interface AnalyzeRequest {
  mint: string;
}

export interface AnalyzeResponse {
  report: import("./dashboard").TokenRiskReport;
  timestamp: number;
}

export interface RuntimeProfile {
  id: string;
  label: string;
  configPath: string;
  strategyStyle: string;
  minBankrollUsd: number;
  maxBankrollUsd?: number;
  summary: string;
}

export interface RuntimeOptionsResponse {
  liveEnabled: boolean;
  bankrollPresetsUsd: number[];
  profiles: RuntimeProfile[];
  recommendation:
    | (RuntimeProfile & {
        bankrollUsd: number;
      })
    | null;
  activeProfileId?: string;
  current: {
    workflowMode: "observe" | "paper" | "live";
    dashboardMode: "paper" | "live";
    botRunning: boolean;
    botStartedAtMs?: number;
    botStoppedAtMs?: number;
    lastRuntimePatchAtMs?: number;
    lastBotError?: string;
    subscriberCount: number;
    configPath: string;
  };
}

export interface RuntimeStartRequest {
  mode: "observe" | "paper" | "live";
  bankrollUsd?: number;
  profileId?: string;
  configPath?: string;
  durationSec?: number;
}

export interface RuntimeControlResponse {
  ok: boolean;
  mode?: "observe" | "paper" | "live";
  configPath?: string;
  profileId?: string;
  bankrollUsd?: number;
  status: {
    workflowMode: "observe" | "paper" | "live";
    dashboardMode: "paper" | "live";
    botRunning: boolean;
    botStartedAtMs?: number;
    botStoppedAtMs?: number;
    lastRuntimePatchAtMs?: number;
    lastBotError?: string;
    subscriberCount: number;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };
