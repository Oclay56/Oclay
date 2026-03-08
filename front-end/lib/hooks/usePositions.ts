"use client";

import { useQuery } from "@tanstack/react-query";
import { PositionsQueryParams } from "../types";
import { fetchPositions } from "../api/client";
import { usePollingInterval } from "./usePollingInterval";

const QUERY_KEY = "positions";

export function usePositions(params: PositionsQueryParams = {}) {
  const intervalMs = usePollingInterval(2000);
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => fetchPositions(params),
    staleTime: 2000,
    refetchInterval: intervalMs,
  });
}
