"use client";

import { useBlocks } from "@/lib/hooks";
import { useFiltersStore } from "@/lib/state";
import { PageHeader } from "@/components/shell/PageHeader";
import { BlocksTable } from "@/components/tables/BlocksTable";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function BlocklistPage() {
  const { blocklist, setBlocklistFilters } = useFiltersStore();

  const { data, isLoading, isError, error, refetch } = useBlocks({
    activeOnly: blocklist.activeOnly,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blocklist"
        description="View and manage blocked tokens"
        action={
          <div className="flex items-center gap-2">
            <Switch
              checked={blocklist.activeOnly}
              onCheckedChange={(v) => setBlocklistFilters({ activeOnly: v })}
            />
            <Label className="text-xs text-[#A7AFBF]">Active Only</Label>
          </div>
        }
      />

      <SectionFrame>
        {isLoading && <LoadingState message="Loading blocks..." />}
        {isError && (
          <ErrorState
            title="Failed to load blocks"
            description={error?.message}
            onRetry={refetch}
          />
        )}
        {data && <BlocksTable blocks={data} />}
      </SectionFrame>
    </div>
  );
}
