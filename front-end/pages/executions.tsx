"use client";

import { useState } from "react";
import { useExecutions } from "@/lib/hooks";
import { useFiltersStore } from "@/lib/state";
import { PageHeader } from "@/components/shell/PageHeader";
import { ExecutionsTable } from "@/components/tables/ExecutionsTable";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableToolbar } from "@/components/filters/TableToolbar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimeWindowSelect } from "@/components/filters/TimeWindowSelect";

export default function ExecutionsPage() {
  const { executions, setExecutionsFilters } = useFiltersStore();
  const [searchQuery, setSearchQuery] = useState("");
  const sideSelectValue =
    executions.side === "BUY" || executions.side === "SELL" ? executions.side : "ALL";

  const { data, isLoading, isError, error, refetch } = useExecutions({
    onlyFailures: executions.onlyFailures,
    hideSuccess: executions.hideSuccess,
    side: executions.side || undefined,
    mint: searchQuery || undefined,
    windowMin: executions.windowMin,
  });

  const extraFilters = (
    <>
      <div className="flex items-center gap-2">
        <Switch
          checked={executions.hideSuccess}
          onCheckedChange={(v) => setExecutionsFilters({ hideSuccess: v })}
        />
        <Label className="text-xs text-[#A7AFBF]">Hide Success</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={executions.onlyFailures}
          onCheckedChange={(v) => setExecutionsFilters({ onlyFailures: v })}
        />
        <Label className="text-xs text-[#A7AFBF]">Only Failures</Label>
      </div>
      <Select
        value={sideSelectValue}
        onValueChange={(v) =>
          setExecutionsFilters({
            side: v === "ALL" ? "" : (v as "BUY" | "SELL"),
          })
        }
      >
        <SelectTrigger className="w-24 text-xs text-[#F2F5FA]">
          <SelectValue placeholder="Side" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All</SelectItem>
          <SelectItem value="BUY">Buy</SelectItem>
          <SelectItem value="SELL">Sell</SelectItem>
        </SelectContent>
      </Select>
      <TimeWindowSelect
        value={executions.windowMin}
        onChange={(v) => setExecutionsFilters({ windowMin: v })}
      />
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executions"
        description="View execution history and results"
      />

      <TableToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by mint..."
        extraFilters={extraFilters}
      />

      <SectionFrame>
        {isLoading && <LoadingState message="Loading executions..." />}
        {isError && (
          <ErrorState
            title="Failed to load executions"
            description={error?.message}
            onRetry={refetch}
          />
        )}
        {data && <ExecutionsTable executions={data} />}
      </SectionFrame>
    </div>
  );
}
