"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMintDetail } from "../api/client";
import { usePollingInterval } from "./usePollingInterval";

const QUERY_KEY = "mint-detail";

export function useMintDetail(mint: string | null) {
  const intervalMs = usePollingInterval(10000);
  return useQuery({
    queryKey: [QUERY_KEY, mint],
    queryFn: () => (mint ? fetchMintDetail(mint) : null),
    enabled: !!mint,
    staleTime: 10000,
    refetchInterval: intervalMs,
  });
}
