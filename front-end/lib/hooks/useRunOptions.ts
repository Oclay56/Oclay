"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchRuntimeOptions,
  startRuntimeWorkflow,
  stopRuntimeWorkflow,
} from "../api/client";
import type { RuntimeStartRequest } from "../types";

const RUNTIME_OPTIONS_QUERY_KEY = "runtime-options";
const SYSTEM_QUERY_KEY = "system";

export function useRunOptions(bankrollUsd?: number) {
  return useQuery({
    queryKey: [RUNTIME_OPTIONS_QUERY_KEY, bankrollUsd],
    queryFn: () => fetchRuntimeOptions(bankrollUsd),
    staleTime: 3_000,
    refetchInterval: 3_000,
  });
}

export function useRuntimeWorkflowActions() {
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: (request: RuntimeStartRequest) => startRuntimeWorkflow(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SYSTEM_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [RUNTIME_OPTIONS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["strategy"] });
    },
  });

  const stop = useMutation({
    mutationFn: () => stopRuntimeWorkflow(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SYSTEM_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [RUNTIME_OPTIONS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["strategy"] });
    },
  });

  return {
    startWorkflow: start.mutateAsync,
    stopWorkflow: stop.mutateAsync,
    starting: start.isPending,
    stopping: stop.isPending,
    startError: start.error,
    stopError: stop.error,
  };
}
