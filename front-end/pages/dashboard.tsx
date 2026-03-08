"use client";

import { useDashboardSnapshot } from "@/lib/hooks";
import { useFiltersStore } from "@/lib/state";
import { StatCard } from "@/components/cards/StatCard";
import { CapitalCard } from "@/components/cards/CapitalCard";
import { StreamHealthCard } from "@/components/cards/StreamHealthCard";
import { Sell429Card } from "@/components/cards/Sell429Card";
import { AlertCard } from "@/components/cards/AlertCard";
import { FocusMintPanel } from "@/components/focus/FocusMintPanel";
import { ReportsTable } from "@/components/tables/ReportsTable";
import { PositionsTable } from "@/components/tables/PositionsTable";
import { ExecutionsTable } from "@/components/tables/ExecutionsTable";
import { DecisionsTable } from "@/components/tables/DecisionsTable";
import { BlocksTable } from "@/components/tables/BlocksTable";
import { MintRollupsTable } from "@/components/tables/MintRollupsTable";
import { LeaderboardTable } from "@/components/tables/LeaderboardTable";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";

export default function DashboardPage() {
  const { dashboard } = useFiltersStore();
  const { data, isLoading, isError, error, refresh } = useDashboardSnapshot({
    refreshSec: dashboard.refreshSec,
    rows: dashboard.rows,
    hideSuccess: dashboard.hideSuccess,
    onlyFailures: dashboard.onlyFailures,
    focusMint: dashboard.focusMint,
    alertsWindowMin: dashboard.alertsWindowMin,
    rollupWindowMin: dashboard.rollupWindowMin,
  });

  if (isLoading) {
    return <LoadingState message="Loading dashboard..." />;
  }

  if (isError) {
    return (
      <ErrorState
        title="Failed to load dashboard"
        description={error?.message || "Unknown error"}
        onRetry={refresh}
      />
    );
  }

  if (!data) {
    return <ErrorState title="No data available" onRetry={refresh} />;
  }

  const { counts, activity, health, capital, streamHealth, sell429, alerts, focus } = data;

  const recentReports = data.recentReports.slice(0, dashboard.rows);
  const openPositions = data.openPositions.slice(0, dashboard.rows);
  const recentExecutions = data.recentExecutions.slice(0, dashboard.rows);
  const recentDecisions = data.recentDecisions.slice(0, dashboard.rows);
  const activeBlocks = data.activeBlocks.slice(0, dashboard.rows);
  const mintRollups = data.mintRollups.slice(0, dashboard.rows);
  const leaderboard = data.leaderboard?.slice(0, 5) || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StatCard label="Tokens" value={counts.tokens} />
        <StatCard label="Risk Reports" value={counts.riskReports} />
        <StatCard label="Open Positions" value={counts.openPositions} />
        <StatCard
          label="Failed Execs"
          value={counts.failedExecutions}
          variant={counts.failedExecutions > 0 ? "warning" : "default"}
        />
        <StatCard label="Active Blocks" value={counts.activeBlocks} />
        <StatCard label="Reports (1m)" value={activity.reportsLast1m} subValue="last min" />
        <StatCard label="Execs (5m)" value={activity.executionsLast5m} subValue="last 5 min" />
        <StatCard
          label="Stale Risk"
          value={health.staleRiskData ? "YES" : "NO"}
          variant={health.staleRiskData ? "danger" : "success"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <CapitalCard capital={capital} className="lg:col-span-2" />
        <div className="space-y-4">
          <StreamHealthCard streamHealth={streamHealth} />
          <Sell429Card sell429={sell429} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AlertCard alerts={alerts} className="lg:col-span-2" />
        <FocusMintPanel focus={focus} />
      </div>

      <SectionFrame title="Recent Decisions">
        <DecisionsTable decisions={recentDecisions} />
      </SectionFrame>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionFrame title="Recent Risk Reports">
          <ReportsTable reports={recentReports} />
        </SectionFrame>
        <SectionFrame title="Open Positions">
          <PositionsTable positions={openPositions} />
        </SectionFrame>
      </div>

      <SectionFrame title="Recent Executions">
        <ExecutionsTable executions={recentExecutions} />
      </SectionFrame>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionFrame title="Active Blocks">
          <BlocksTable blocks={activeBlocks} />
        </SectionFrame>
        <SectionFrame title="Mint Rollups">
          <MintRollupsTable rollups={mintRollups} />
        </SectionFrame>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.latency && (
          <SectionFrame title="Latency Summary">
            <div className="grid grid-cols-2 gap-4 p-4">
              <div className="oc-surface-soft rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wide text-[#8B93A7]">Detect to Intent P50</div>
                <div className="mt-1 text-xl font-mono font-semibold text-[#2EC3E5]">
                  {data.latency.detectToIntentMs.p50 === null ? "--" : `${data.latency.detectToIntentMs.p50}ms`}
                </div>
              </div>
              <div className="oc-surface-soft rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wide text-[#8B93A7]">Sent to Confirmed P50</div>
                <div className="mt-1 text-xl font-mono font-semibold text-[#27C587]">
                  {data.latency.sentToConfirmedMs.p50 === null ? "--" : `${data.latency.sentToConfirmedMs.p50}ms`}
                </div>
              </div>
            </div>
            <div className="px-4 pb-4 text-xs text-[#8B93A7]">
              Sample size: {data.latency.sampleSize} | Detect samples: {data.latency.detectToIntentSamples} | Confirm samples: {data.latency.sentToConfirmedSamples}
            </div>
          </SectionFrame>
        )}
        <SectionFrame title="Leaderboard">
          <LeaderboardTable entries={leaderboard} />
        </SectionFrame>
      </div>
    </div>
  );
}
