"use client";

import { useQuery } from "@tanstack/react-query";
import { BlocksQueryParams } from "../types";
import { fetchBlocks } from "../api/client";
import { usePollingInterval } from "./usePollingInterval";

const QUERY_KEY = "blocks";

export function useBlocks(params: BlocksQueryParams = {}) {
  const intervalMs = usePollingInterval(5000);
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => fetchBlocks(params),
    staleTime: 5000,
    refetchInterval: intervalMs,
  });
}
