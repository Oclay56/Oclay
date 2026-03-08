export const API_ENDPOINTS = {
  dashboard: "/api/dashboard",
  positions: "/api/positions",
  executions: "/api/executions",
  risk: "/api/risk",
  blocks: "/api/blocks",
  latency: "/api/latency",
  leaderboard: "/api/leaderboard",
  system: "/api/system",
  runtimeOptions: "/api/runtime/options",
  runtimeStart: "/api/runtime/start",
  runtimeStop: "/api/runtime/stop",
  strategy: "/api/strategy",
  mints: (mint: string) => `/api/mints/${mint}`,
  analyze: "/api/analyze",
  liveEvents: "/api/live/events",
} as const;

export const DEFAULT_REFRESH_INTERVAL = 2000; // 2 seconds
export const STALE_DATA_THRESHOLD = 10000; // 10 seconds
