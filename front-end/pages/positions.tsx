"use client";

import { useState } from "react";
import { usePositions } from "@/lib/hooks";
import { useFiltersStore, useUIStore } from "@/lib/state";
import { PageHeader } from "@/components/shell/PageHeader";
import { PositionsTable } from "@/components/tables/PositionsTable";
import { MintDetailDrawer } from "@/components/focus/MintDetailDrawer";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableToolbar } from "@/components/filters/TableToolbar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export default function PositionsPage() {
  const { positions, setPositionsFilters } = useFiltersStore();
  const { selectedMint, drawerOpen, setDrawerOpen } = useUIStore();
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, isError, error, refetch } = usePositions({
    status: positions.status,
    mint: searchQuery || undefined,
  });

  const handleRowClick = (position: { mint: string }) => {
    useUIStore.getState().setSelectedMint(position.mint);
    setDrawerOpen(true);
  };

  const handleStatusChange = (value: string) => {
    if (value) {
      setPositionsFilters({ status: value as "all" | "active" | "closed" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Positions"
        description="View and manage open and closed positions"
        action={
          <ToggleGroup
            type="single"
            value={positions.status}
            onValueChange={handleStatusChange}
            className="oc-surface-soft rounded-lg p-1"
          >
            <ToggleGroupItem
              value="all"
              className="text-xs data-[state=on]:bg-[#2EC3E5]/15 data-[state=on]:text-[#2EC3E5]"
            >
              All
            </ToggleGroupItem>
            <ToggleGroupItem
              value="active"
              className="text-xs data-[state=on]:bg-[#27C587]/15 data-[state=on]:text-[#27C587]"
            >
              Active
            </ToggleGroupItem>
            <ToggleGroupItem
              value="closed"
              className="text-xs data-[state=on]:bg-[#8B93A7]/15 data-[state=on]:text-[#8B93A7]"
            >
              Closed
            </ToggleGroupItem>
          </ToggleGroup>
        }
      />

      <TableToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by mint..."
      />

      <SectionFrame>
        {isLoading && <LoadingState message="Loading positions..." />}
        {isError && (
          <ErrorState
            title="Failed to load positions"
            description={error?.message}
            onRetry={refetch}
          />
        )}
        {data && (
          <PositionsTable
            positions={data}
            onRowClick={handleRowClick}
          />
        )}
      </SectionFrame>

      <MintDetailDrawer
        mint={selectedMint}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
