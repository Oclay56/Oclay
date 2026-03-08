"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchStrategy } from "../api/client";
import { usePollingInterval } from "./usePollingInterval";

const QUERY_KEY = "strategy";

export function useStrategy() {
  const intervalMs = usePollingInterval(3000);
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: fetchStrategy,
    staleTime: 3_000,
    refetchInterval: intervalMs,
  });
}
