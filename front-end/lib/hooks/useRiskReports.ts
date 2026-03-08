"use client";

import { useQuery } from "@tanstack/react-query";
import { RiskQueryParams } from "../types";
import { fetchRiskReports } from "../api/client";
import { usePollingInterval } from "./usePollingInterval";

const QUERY_KEY = "risk-reports";

export function useRiskReports(params: RiskQueryParams = {}) {
  const intervalMs = usePollingInterval(5000);
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => fetchRiskReports(params),
    staleTime: 5000,
    refetchInterval: intervalMs,
  });
}
