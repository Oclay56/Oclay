import {
  DashboardSnapshot,
  Position,
  Execution,
  TokenRiskReport,
  MintDetail,
  ActiveBlock,
  LatencyMetrics,
  LeaderboardEntry,
  SystemState,
  StrategyState,
  AnalyzeRequest,
  AnalyzeResponse,
  DashboardQueryParams,
  PositionsQueryParams,
  ExecutionsQueryParams,
  RiskQueryParams,
  BlocksQueryParams,
  LatencyQueryParams,
  LeaderboardQueryParams,
  RuntimeEvent,
  RuntimeOptionsResponse,
  RuntimeStartRequest,
  RuntimeControlResponse,
} from "../types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

// Helper to build query string
function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return query ? `?${query}` : "";
}

// Generic fetch helper with error handling
async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

// Dashboard API
export async function fetchDashboard(params: DashboardQueryParams = {}): Promise<DashboardSnapshot> {
  const queryString = buildQueryString(params as Record<string, string | number | boolean | undefined>);
  return fetchApi<DashboardSnapshot>(`/api/dashboard${queryString}`);
}

// Positions API
export async function fetchPositions(params: PositionsQueryParams = {}): Promise<Position[]> {
  const queryString = buildQueryString(params as Record<string, string | number | boolean | undefined>);
  return fetchApi<Position[]>(`/api/positions${queryString}`);
}

// Executions API
export async function fetchExecutions(params: ExecutionsQueryParams = {}): Promise<Execution[]> {
  const queryString = buildQueryString(params as Record<string, string | number | boolean | undefined>);
  return fetchApi<Execution[]>(`/api/executions${queryString}`);
}

// Risk Reports API
export async function fetchRiskReports(params: RiskQueryParams = {}): Promise<TokenRiskReport[]> {
  const queryString = buildQueryString(params as Record<string, string | number | boolean | undefined>);
  return fetchApi<TokenRiskReport[]>(`/api/risk${queryString}`);
}

// Blocks API
export async function fetchBlocks(params: BlocksQueryParams = {}): Promise<ActiveBlock[]> {
  const queryString = buildQueryString(params as Record<string, string | number | boolean | undefined>);
  return fetchApi<ActiveBlock[]>(`/api/blocks${queryString}`);
}

// Latency API
export async function fetchLatency(params: LatencyQueryParams = {}): Promise<LatencyMetrics> {
  const queryString = buildQueryString(params as Record<string, string | number | boolean | undefined>);
  return fetchApi<LatencyMetrics>(`/api/latency${queryString}`);
}

// Leaderboard API
export async function fetchLeaderboard(params: LeaderboardQueryParams = {}): Promise<LeaderboardEntry[]> {
  const queryString = buildQueryString(params as Record<string, string | number | boolean | undefined>);
  return fetchApi<LeaderboardEntry[]>(`/api/leaderboard${queryString}`);
}

// System API
export async function fetchSystem(): Promise<SystemState> {
  return fetchApi<SystemState>("/api/system");
}

export async function fetchRuntimeOptions(bankrollUsd?: number): Promise<RuntimeOptionsResponse> {
  const queryString =
    bankrollUsd !== undefined && Number.isFinite(bankrollUsd)
      ? buildQueryString({ bankrollUsd })
      : "";
  return fetchApi<RuntimeOptionsResponse>(`/api/runtime/options${queryString}`);
}

export async function startRuntimeWorkflow(request: RuntimeStartRequest): Promise<RuntimeControlResponse> {
  return fetchApi<RuntimeControlResponse>("/api/runtime/start", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function stopRuntimeWorkflow(): Promise<RuntimeControlResponse> {
  return fetchApi<RuntimeControlResponse>("/api/runtime/stop", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// Mint Detail API
export async function fetchMintDetail(mint: string): Promise<MintDetail | null> {
  return fetchApi<MintDetail | null>(`/api/mints/${mint}`);
}

export async function fetchStrategy(): Promise<StrategyState> {
  return fetchApi<StrategyState>("/api/strategy");
}

// Analyze API
export async function analyzeMint(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  return fetchApi<AnalyzeResponse>("/api/analyze", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// SSE Connection for Runtime Events
export function createRuntimeEventSource(
  onEvent: (event: RuntimeEvent) => void,
  onError?: (error: Event) => void
): EventSource {
  const source = new EventSource(`${BASE_URL}/api/live/events`);

  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent(data);
    } catch (err) {
      console.error("Failed to parse runtime event:", err);
    }
  };

  if (onError) {
    source.onerror = onError;
  }

  return source;
}
