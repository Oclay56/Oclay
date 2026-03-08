"use client";

import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/StatusDot";
import { getModeBadge } from "@/lib/utils/badges";
import { Alert, Mode } from "@/lib/types";
import { useUIStore } from "@/lib/state";
import { Search, Bell, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatRelativeTime } from "@/lib/utils/time";

interface TopStatusBarProps {
  mode?: Mode;
  uptimeSec?: number;
  dbPath?: string;
  streamEnabled?: boolean;
  streamConnected?: boolean;
  streamStale?: boolean;
  lastEventAtMs?: number;
  alerts?: Alert[];
  onRefresh?: () => void;
}

export function TopStatusBar({
  mode,
  uptimeSec,
  dbPath,
  streamEnabled,
  streamConnected,
  streamStale,
  alerts = [],
  onRefresh,
}: TopStatusBarProps) {
  const {
    searchQuery,
    setSearchQuery,
    autoRefresh,
    toggleAutoRefresh,
    showNotifications,
    toggleNotifications,
  } = useUIStore();
  const modeBadge = mode
    ? getModeBadge(mode)
    : {
        bg: "bg-[#8B93A7]/15",
        text: "text-[#8B93A7]",
        label: "LOADING",
      };

  // Format uptime
  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const streamStatus =
    streamEnabled === false
      ? { dot: "info" as const, label: "Polling", pulsing: false }
      : streamConnected === undefined
      ? { dot: "neutral" as const, label: "Waiting", pulsing: false }
      : streamConnected && !streamStale
        ? { dot: "ok" as const, label: "Live", pulsing: true }
        : streamStale
          ? { dot: "warning" as const, label: "Stale", pulsing: false }
          : { dot: "danger" as const, label: "Disconnected", pulsing: false };
  const criticalCount = alerts.filter((alert) => alert.severity === "CRITICAL").length;

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-30 h-14",
        "bg-[#0B0D10]/95 backdrop-blur-sm",
        "border-b border-[rgba(142,152,169,0.12)]",
        "flex items-center justify-between px-4",
        "transition-all duration-300"
      )}
      style={{
        left: "var(--sidebar-width, 14rem)",
      }}
    >
      {/* Left: Status indicators */}
      <div className="flex items-center gap-4">
        {/* Mode badge */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium",
            modeBadge.bg,
            modeBadge.text
          )}
        >
          {modeBadge.label}
        </span>

        {/* Uptime */}
        <div className="flex items-center gap-2 text-xs text-[#A7AFBF]">
          <span className="text-[#8B93A7]">Uptime:</span>
          <span className="font-mono text-[#F2F5FA]">
            {uptimeSec === undefined ? "--" : formatUptime(uptimeSec)}
          </span>
        </div>

        {/* DB Path */}
        <div className="hidden items-center gap-2 text-xs text-[#A7AFBF] lg:flex">
          <span className="text-[#8B93A7]">DB:</span>
          <span className="font-mono text-[#F2F5FA]">{dbPath || "--"}</span>
        </div>

        {/* Stream status */}
        <div className="flex items-center gap-2">
          <StatusDot
            status={streamStatus.dot}
            pulsing={streamStatus.pulsing}
          />
          <span className="text-xs text-[#A7AFBF]">
            {streamStatus.label}
          </span>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        {/* Global search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8B93A7]" />
          <input
            type="text"
            placeholder="Search mint..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "h-8 w-48 rounded-lg pl-9 pr-3",
              "text-xs text-[#F2F5FA] placeholder:text-[#8B93A7]",
              "oc-control",
              "focus:border-[#2EC3E5]/50 focus:outline-none",
              "transition-colors duration-150"
            )}
          />
        </div>

        {/* Auto-refresh toggle */}
        <button
          onClick={toggleAutoRefresh}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            autoRefresh
              ? "text-[#27C587] bg-[#27C587]/15"
              : "text-[#8B93A7] hover:bg-[#1E222C]",
            "transition-colors duration-150"
          )}
          title={autoRefresh ? "Auto-refresh on" : "Auto-refresh off"}
        >
          <RefreshCw className={cn("h-4 w-4", autoRefresh && "animate-spin")} style={{ animationDuration: '3s' }} />
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={toggleNotifications}
            className={cn(
              "relative flex h-8 w-8 items-center justify-center rounded-lg",
              showNotifications
                ? "bg-[#2EC3E5]/15 text-[#2EC3E5]"
                : "oc-surface-soft text-[#8B93A7] hover:bg-[rgba(30,34,44,0.28)] hover:text-[#F2F5FA]",
              "transition-colors duration-150"
            )}
            title={showNotifications ? "Hide notifications" : "Show notifications"}
          >
            <Bell className="h-4 w-4" />
            {criticalCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#F24E4E]" />
            )}
          </button>
          {showNotifications && (
            <div className="oc-surface-popover absolute right-0 top-10 z-50 w-96 rounded-lg p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-[#8B93A7]">Alerts</span>
                {criticalCount > 0 ? (
                  <Badge variant="danger" size="sm">{criticalCount} critical</Badge>
                ) : (
                  <Badge variant="neutral" size="sm">No critical alerts</Badge>
                )}
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {alerts.length === 0 ? (
                  <div className="oc-surface-soft rounded-md p-2 text-xs text-[#8B93A7]">No active alerts</div>
                ) : (
                  alerts.slice(0, 8).map((alert) => (
                    <div key={`${alert.code}:${alert.mint}:${alert.lastSeenAtMs}`} className="oc-surface-soft rounded-md p-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <Badge variant={alert.severity === "CRITICAL" ? "danger" : "warning"} size="sm">
                          {alert.code}
                        </Badge>
                        <span className="text-[10px] text-[#8B93A7]">{formatRelativeTime(alert.lastSeenAtMs)}</span>
                      </div>
                      <div className="truncate font-mono text-[11px] text-[#F2F5FA]">{alert.mint}</div>
                      <div className="mt-0.5 text-xs text-[#A7AFBF]">{alert.summary}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Refresh button */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className={cn(
              "oc-surface-soft flex h-8 items-center gap-1.5 rounded-lg px-3",
              "text-xs font-medium text-[#F2F5FA]",
              "hover:bg-[rgba(39,43,54,0.3)] transition-colors duration-150"
            )}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}
      </div>
    </header>
  );
}
