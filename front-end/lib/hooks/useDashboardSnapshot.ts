"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { DashboardSnapshot, DashboardQueryParams, RuntimeDashboardStatePatch } from "../types";
import { fetchDashboard } from "../api/client";
import { usePollingInterval } from "./usePollingInterval";

const QUERY_KEY = "dashboard";

export function useDashboardSnapshot(params: DashboardQueryParams = {}) {
  const queryClient = useQueryClient();
  const intervalMs = usePollingInterval((params.refreshSec || 2) * 1000);

  const query = useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => fetchDashboard(params),
    refetchInterval: intervalMs,
    staleTime: 1000,
  });

  // Manual refresh function
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [QUERY_KEY, params] });
  }, [queryClient, params]);

  // Apply runtime patch to current snapshot
  const applyPatch = useCallback(
    (patch: RuntimeDashboardStatePatch) => {
      queryClient.setQueriesData<DashboardSnapshot>({ queryKey: [QUERY_KEY] }, (old) => {
        if (!old) return old;

        const updated: DashboardSnapshot = { ...old };

        if (patch.stream) {
          updated.streamHealth = {
            ...updated.streamHealth,
            ...patch.stream,
          };
        }

        if (patch.sell429) {
          updated.sell429 = {
            ...updated.sell429,
            ...patch.sell429,
            globalActive: !!patch.sell429.globalCooldownUntilMs && patch.sell429.globalCooldownUntilMs > Date.now(),
          };
        }

        if (patch.capital) {
          updated.capital = {
            ...updated.capital,
            ...patch.capital,
          };
        }

        // Update meta timestamp
        updated.meta = {
          ...updated.meta,
          nowMs: Date.now(),
        };

        return updated;
      });
    },
    [queryClient]
  );

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isStale: query.isStale,
    refresh,
    applyPatch,
  };
}
