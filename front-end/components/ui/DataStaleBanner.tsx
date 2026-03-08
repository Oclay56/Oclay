"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface DataStaleBannerProps {
  isStale: boolean;
  onRefresh?: () => void;
  message?: string;
  className?: string;
}

export function DataStaleBanner({
  isStale,
  onRefresh,
  message = "Data is stale. Reconnecting...",
  className,
}: DataStaleBannerProps) {
  if (!isStale) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4",
        "bg-[#F6B046]/10 border border-[#F6B046]/30",
        "rounded-lg px-4 py-3",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-[#F6B046]" />
        <span className="text-sm text-[#F6B046]">{message}</span>
      </div>
      {onRefresh && (
        <button
          onClick={onRefresh}
          className={cn(
            "flex items-center gap-1.5",
            "text-xs font-medium text-[#F6B046]",
            "hover:text-[#F2F5FA] transition-colors"
          )}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      )}
    </div>
  );
}
