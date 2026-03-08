"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RefreshCw, Pause, Play } from "lucide-react";
import { useUIStore } from "@/lib/state";

interface RefreshControlsProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
  className?: string;
}

export function RefreshControls({
  onRefresh,
  isRefreshing,
  className,
}: RefreshControlsProps) {
  const { autoRefresh, toggleAutoRefresh } = useUIStore();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleAutoRefresh}
        className={cn(
          "h-8 w-8 p-0",
          autoRefresh
            ? "text-[#27C587] hover:text-[#27C587] hover:bg-[#27C587]/15"
            : "text-[#8B93A7] hover:text-[#F2F5FA] hover:bg-[#1E222C]"
        )}
        title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
      >
        {autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      {onRefresh && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-8 w-8 p-0 text-[#8B93A7] hover:text-[#F2F5FA] hover:bg-[#1E222C]"
          title="Refresh now"
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </Button>
      )}
    </div>
  );
}
