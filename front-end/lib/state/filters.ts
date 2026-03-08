"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DashboardFilters {
  refreshSec: number;
  rows: number;
  hideSuccess: boolean;
  onlyFailures: boolean;
  focusMint: string;
  alertsWindowMin: number;
  rollupWindowMin: number;
}

interface PositionsFilters {
  status: "all" | "active" | "closed";
  mint: string;
}

interface ExecutionsFilters {
  onlyFailures: boolean;
  hideSuccess: boolean;
  side: "" | "BUY" | "SELL";
  mint: string;
  windowMin: number;
}

interface RiskFilters {
  latestPerMint: boolean;
  criticalOnly: boolean;
  mint: string;
}

interface BlocklistFilters {
  activeOnly: boolean;
}

interface LatencyFilters {
  windowMin: number;
}

interface LeaderboardFilters {
  limit: number;
}

interface FiltersState {
  dashboard: DashboardFilters;
  positions: PositionsFilters;
  executions: ExecutionsFilters;
  risk: RiskFilters;
  blocklist: BlocklistFilters;
  latency: LatencyFilters;
  leaderboard: LeaderboardFilters;

  // Actions
  setDashboardFilters: (filters: Partial<DashboardFilters>) => void;
  setPositionsFilters: (filters: Partial<PositionsFilters>) => void;
  setExecutionsFilters: (filters: Partial<ExecutionsFilters>) => void;
  setRiskFilters: (filters: Partial<RiskFilters>) => void;
  setBlocklistFilters: (filters: Partial<BlocklistFilters>) => void;
  setLatencyFilters: (filters: Partial<LatencyFilters>) => void;
  setLeaderboardFilters: (filters: Partial<LeaderboardFilters>) => void;
  resetAllFilters: () => void;
}

const defaultDashboardFilters: DashboardFilters = {
  refreshSec: 2,
  rows: 8,
  hideSuccess: false,
  onlyFailures: false,
  focusMint: "",
  alertsWindowMin: 15,
  rollupWindowMin: 60,
};

const defaultPositionsFilters: PositionsFilters = {
  status: "all",
  mint: "",
};

const defaultExecutionsFilters: ExecutionsFilters = {
  onlyFailures: false,
  hideSuccess: false,
  side: "",
  mint: "",
  windowMin: 60,
};

const defaultRiskFilters: RiskFilters = {
  latestPerMint: false,
  criticalOnly: false,
  mint: "",
};

const defaultBlocklistFilters: BlocklistFilters = {
  activeOnly: true,
};

const defaultLatencyFilters: LatencyFilters = {
  windowMin: 60,
};

const defaultLeaderboardFilters: LeaderboardFilters = {
  limit: 10,
};

export const useFiltersStore = create<FiltersState>()(
  persist(
    (set) => ({
      dashboard: defaultDashboardFilters,
      positions: defaultPositionsFilters,
      executions: defaultExecutionsFilters,
      risk: defaultRiskFilters,
      blocklist: defaultBlocklistFilters,
      latency: defaultLatencyFilters,
      leaderboard: defaultLeaderboardFilters,

      setDashboardFilters: (filters) =>
        set((state) => ({ dashboard: { ...state.dashboard, ...filters } })),
      setPositionsFilters: (filters) =>
        set((state) => ({ positions: { ...state.positions, ...filters } })),
      setExecutionsFilters: (filters) =>
        set((state) => ({ executions: { ...state.executions, ...filters } })),
      setRiskFilters: (filters) =>
        set((state) => ({ risk: { ...state.risk, ...filters } })),
      setBlocklistFilters: (filters) =>
        set((state) => ({ blocklist: { ...state.blocklist, ...filters } })),
      setLatencyFilters: (filters) =>
        set((state) => ({ latency: { ...state.latency, ...filters } })),
      setLeaderboardFilters: (filters) =>
        set((state) => ({ leaderboard: { ...state.leaderboard, ...filters } })),
      resetAllFilters: () =>
        set({
          dashboard: defaultDashboardFilters,
          positions: defaultPositionsFilters,
          executions: defaultExecutionsFilters,
          risk: defaultRiskFilters,
          blocklist: defaultBlocklistFilters,
          latency: defaultLatencyFilters,
          leaderboard: defaultLeaderboardFilters,
        }),
    }),
    {
      name: "oclay-filters",
    }
  )
);
