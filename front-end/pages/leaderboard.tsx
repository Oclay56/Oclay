"use client";

import { useLeaderboard } from "@/lib/hooks";
import { useFiltersStore } from "@/lib/state";
import { PageHeader } from "@/components/shell/PageHeader";
import { LeaderboardTable } from "@/components/tables/LeaderboardTable";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trophy, TrendingUp, TrendingDown, Target } from "lucide-react";
import { formatUsd, formatPercent } from "@/lib/utils";

export default function LeaderboardPage() {
  const { leaderboard, setLeaderboardFilters } = useFiltersStore();

  const { data, isLoading, isError, error, refetch } = useLeaderboard({
    limit: leaderboard.limit,
  });

  const topPerformer = data?.[0];
  const totalTrades = data?.reduce((sum, entry) => sum + entry.trades, 0) || 0;
  const totalPnl = data?.reduce((sum, entry) => sum + entry.totalPnlUsd, 0) || 0;
  const avgWinRate = data?.length
    ? data.reduce((sum, entry) => sum + entry.winRate, 0) / data.length
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leaderboard"
        description="Strategy performance rankings"
        action={
          <Select
            value={String(leaderboard.limit)}
            onValueChange={(value) => setLeaderboardFilters({ limit: Number(value) })}
          >
            <SelectTrigger className="w-24 text-[#F2F5FA]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">Top 5</SelectItem>
              <SelectItem value="10">Top 10</SelectItem>
              <SelectItem value="20">Top 20</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="oc-surface rounded-lg p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#8B93A7]">
              <Trophy className="h-3 w-3" />
              Top Strategy
            </div>
            <div className="mt-1 text-sm font-medium text-[#F6B046]">
              {topPerformer?.key.replace(/_/g, " ").toUpperCase() || "--"}
            </div>
          </div>
          <div className="oc-surface rounded-lg p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#8B93A7]">
              <Target className="h-3 w-3" />
              Total Trades
            </div>
            <div className="mt-1 text-lg font-mono font-semibold text-[#F2F5FA]">
              {totalTrades.toLocaleString()}
            </div>
          </div>
          <div className="oc-surface rounded-lg p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#8B93A7]">
              <TrendingUp className="h-3 w-3" />
              Avg Win Rate
            </div>
            <div className="mt-1 text-lg font-mono font-semibold text-[#27C587]">
              {formatPercent(avgWinRate)}
            </div>
          </div>
          <div className="oc-surface rounded-lg p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#8B93A7]">
              <TrendingDown className="h-3 w-3" />
              Total PnL
            </div>
            <div
              className={`mt-1 text-lg font-mono font-semibold ${
                totalPnl >= 0 ? "text-[#27C587]" : "text-[#F24E4E]"
              }`}
            >
              {formatUsd(totalPnl, { showSign: true })}
            </div>
          </div>
        </div>
      )}

      <SectionFrame title="Strategy Rankings">
        {isLoading && <LoadingState message="Loading leaderboard..." />}
        {isError && (
          <ErrorState
            title="Failed to load leaderboard"
            description={error?.message}
            onRetry={refetch}
          />
        )}
        {data && <LeaderboardTable entries={data} />}
      </SectionFrame>
    </div>
  );
}
