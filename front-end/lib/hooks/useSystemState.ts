"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchSystem } from "../api/client";
import { usePollingInterval } from "./usePollingInterval";

const QUERY_KEY = "system";

export function useSystemState() {
  const intervalMs = usePollingInterval(3000);
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: fetchSystem,
    staleTime: 3_000,
    refetchInterval: intervalMs,
  });
}
