"use client";

import { useQuery } from "@tanstack/react-query";
import { LeaderboardQueryParams } from "../types";
import { fetchLeaderboard } from "../api/client";
import { usePollingInterval } from "./usePollingInterval";

const QUERY_KEY = "leaderboard";

export function useLeaderboard(params: LeaderboardQueryParams = {}) {
  const intervalMs = usePollingInterval(30000);
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => fetchLeaderboard(params),
    staleTime: 30000,
    refetchInterval: intervalMs,
  });
}
