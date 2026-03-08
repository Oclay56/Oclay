"use client";

import { useLatency } from "@/lib/hooks";
import { useFiltersStore } from "@/lib/state";
import { PageHeader } from "@/components/shell/PageHeader";
import { LatencyPanel } from "@/components/telemetry/LatencyPanel";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TimeWindowSelect } from "@/components/filters/TimeWindowSelect";


export default function LatencyPage() {
  const { latency, setLatencyFilters } = useFiltersStore();

  const { data, isLoading, isError, error, refetch } = useLatency({
    windowMin: latency.windowMin,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Latency"
        description="Monitor execution and detection latency metrics"
        action={
          <TimeWindowSelect
            value={latency.windowMin}
            onChange={(v) => setLatencyFilters({ windowMin: v })}
          />
        }
      />

      {isLoading && <LoadingState message="Loading latency data..." />}
      {isError && (
        <ErrorState
          title="Failed to load latency data"
          description={error?.message}
          onRetry={refetch}
        />
      )}
      {data && <LatencyPanel latency={data} />}
    </div>
  );
}
