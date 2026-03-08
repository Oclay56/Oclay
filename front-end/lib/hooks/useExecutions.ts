"use client";

import { useQuery } from "@tanstack/react-query";
import { ExecutionsQueryParams } from "../types";
import { fetchExecutions } from "../api/client";
import { usePollingInterval } from "./usePollingInterval";

const QUERY_KEY = "executions";

export function useExecutions(params: ExecutionsQueryParams = {}) {
  const intervalMs = usePollingInterval(2000);
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => fetchExecutions(params),
    staleTime: 2000,
    refetchInterval: intervalMs,
  });
}
