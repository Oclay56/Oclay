"use client";

import { useUIStore } from "../state";

export function usePollingInterval(defaultMs: number): number | false {
  const autoRefresh = useUIStore((state) => state.autoRefresh);
  return autoRefresh ? defaultMs : false;
}

