"use client";

import { cn } from "@/lib/utils";
import { SidebarNav } from "./SidebarNav";
import { TopStatusBar } from "./TopStatusBar";
import { useUIStore } from "@/lib/state";
import { useDashboardSnapshot, useRuntimeEvents } from "@/lib/hooks";
import { DataStaleBanner } from "@/components/ui/DataStaleBanner";
import { RouteErrorBoundary } from "@/components/ui/RouteErrorBoundary";
import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";

interface AppShellProps {
  children: React.ReactNode;
}

const WALLPAPER_ROUTES = new Set([
  "/",
  "/dashboard",
  "/positions",
  "/executions",
  "/risk",
  "/blocklist",
  "/latency",
  "/leaderboard",
  "/analyze",
  "/strategy",
  "/strategies",
  "/system",
]);

export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const { sidebarCollapsed, autoRefresh } = useUIStore();
  const queryClient = useQueryClient();
  const { data, applyPatch } = useDashboardSnapshot({
    refreshSec: autoRefresh ? 2 : 60,
  });
  const runtimeEvents = useRuntimeEvents(applyPatch, true);
  const runtimeFeedDisconnected =
    !runtimeEvents.connected && Boolean(runtimeEvents.error);
  const showStaleBanner =
    Boolean(data?.streamHealth.stale) || runtimeFeedDisconnected;
  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries();
  }, [queryClient]);
  const hasRouteWallpaper = WALLPAPER_ROUTES.has(location.pathname);
  const sharedWallpaper = "/images/executions-wallpaper.jpg";

  // Update CSS variable for sidebar width
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      sidebarCollapsed ? "4rem" : "14rem"
    );
  }, [sidebarCollapsed]);

  return (
    <div className="min-h-screen bg-[#0B0D10]">
      {/* Sidebar */}
      <SidebarNav />

      {/* Top status bar */}
      <TopStatusBar
        mode={data?.meta.mode}
        uptimeSec={data?.meta.uptimeSec}
        dbPath={data?.meta.dbPath}
        streamEnabled={data?.streamHealth.enabled}
        streamConnected={data?.streamHealth.connected}
        streamStale={data?.streamHealth.stale}
        lastEventAtMs={data?.streamHealth.lastEventAtMs}
        alerts={data?.alerts || []}
        onRefresh={refreshAll}
      />

      {/* Main content */}
      <main
        className={cn(
          "relative isolate min-h-screen pt-14 transition-all duration-300",
          hasRouteWallpaper ? "bg-[#08090D]" : "bg-[#0B0D10]"
        )}
        style={{
          marginLeft: sidebarCollapsed ? "4rem" : "14rem",
        }}
      >
        {hasRouteWallpaper && (
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <div
              className="absolute inset-0 scale-[1.04] bg-cover bg-center bg-no-repeat opacity-72"
              style={{ backgroundImage: `url('${sharedWallpaper}')` }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_18%,rgba(255,255,255,0.07),transparent_34%),linear-gradient(180deg,rgba(7,8,11,0.18)_0%,rgba(8,9,13,0.28)_45%,rgba(8,9,12,0.42)_100%)]" />
            <div className="absolute inset-0 backdrop-blur-[1.2px]" />
          </div>
        )}

        <div className={cn("relative z-10 p-6", hasRouteWallpaper && "bg-[rgba(7,10,16,0.06)]")}>
          {/* Data stale banner */}
          <DataStaleBanner
            isStale={showStaleBanner}
            onRefresh={refreshAll}
            message={
              runtimeFeedDisconnected
                ? "Runtime feed disconnected. Waiting to reconnect..."
                : "Data is stale. Reconnecting..."
            }
            className="mb-6"
          />

          {/* Page content */}
          <RouteErrorBoundary>{children}</RouteErrorBoundary>
        </div>
      </main>
    </div>
  );
}
