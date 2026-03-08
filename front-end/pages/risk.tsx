"use client";

import { useState } from "react";
import { useRiskReports } from "@/lib/hooks";
import { useFiltersStore, useUIStore } from "@/lib/state";
import { PageHeader } from "@/components/shell/PageHeader";
import { ReportsTable } from "@/components/tables/ReportsTable";
import { MintDetailDrawer } from "@/components/focus/MintDetailDrawer";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableToolbar } from "@/components/filters/TableToolbar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function RiskPage() {
  const { risk, setRiskFilters } = useFiltersStore();
  const { selectedMint, drawerOpen, setDrawerOpen } = useUIStore();
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, isError, error, refetch } = useRiskReports({
    latestPerMint: risk.latestPerMint,
    criticalOnly: risk.criticalOnly,
    mint: searchQuery || undefined,
  });

  const extraFilters = (
    <>
      <div className="flex items-center gap-2">
        <Switch
          checked={risk.latestPerMint}
          onCheckedChange={(v) => setRiskFilters({ latestPerMint: v })}
        />
        <Label className="text-xs text-[#A7AFBF]">Latest Per Mint</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={risk.criticalOnly}
          onCheckedChange={(v) => setRiskFilters({ criticalOnly: v })}
        />
        <Label className="text-xs text-[#A7AFBF]">Critical Only</Label>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk Reports"
        description="View risk analysis reports for tokens"
      />

      <TableToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by mint..."
        extraFilters={extraFilters}
      />

      <SectionFrame>
        {isLoading && <LoadingState message="Loading risk reports..." />}
        {isError && (
          <ErrorState
            title="Failed to load risk reports"
            description={error?.message}
            onRetry={refetch}
          />
        )}
        {data && <ReportsTable reports={data} />}
      </SectionFrame>

      <MintDetailDrawer
        mint={selectedMint}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
