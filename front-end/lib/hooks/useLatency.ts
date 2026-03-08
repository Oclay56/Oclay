"use client";

import { useQuery } from "@tanstack/react-query";
import { LatencyQueryParams } from "../types";
import { fetchLatency } from "../api/client";
import { usePollingInterval } from "./usePollingInterval";

const QUERY_KEY = "latency";

export function useLatency(params: LatencyQueryParams = {}) {
  const intervalMs = usePollingInterval(10000);
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => fetchLatency(params),
    staleTime: 10000,
    refetchInterval: intervalMs,
  });
}
