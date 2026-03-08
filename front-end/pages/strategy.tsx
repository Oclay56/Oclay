"use client";

import { useStrategy } from "@/lib/hooks";
import { PageHeader } from "@/components/shell/PageHeader";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Badge } from "@/components/ui/Badge";
import { StrategyState } from "@/lib/types";

const SECTIONS = [
  { key: "assets", title: "Assets" },
  { key: "discovery", title: "Discovery" },
  { key: "analysis", title: "Analysis" },
  { key: "strategy", title: "Strategy" },
  { key: "execution", title: "Execution" },
  { key: "probe", title: "Probe" },
  { key: "paper", title: "Paper Model" },
  { key: "guardian", title: "Guardian" },
  { key: "telemetry", title: "Telemetry" },
] as const satisfies ReadonlyArray<{ key: keyof StrategyState; title: string }>;

export default function StrategyPage() {
  const { data, isLoading, isError, error, refetch } = useStrategy();

  if (isLoading) {
    return <LoadingState message="Loading strategy config..." />;
  }

  if (isError) {
    return (
      <ErrorState
        title="Failed to load strategy config"
        description={error?.message}
        onRetry={refetch}
      />
    );
  }

  if (!data) {
    return <ErrorState title="No strategy data available" onRetry={refetch} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Strategies"
        description="Loaded bot configuration and workflow settings"
      />

      <SectionFrame title="Overview">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.liveEnabled ? "danger" : "info"}>
              {data.liveEnabled ? "LIVE ENABLED" : "PAPER SAFE"}
            </Badge>
            <Badge variant={data.killSwitchActive ? "danger" : "success"}>
              {data.killSwitchActive ? "KILL SWITCH ACTIVE" : "KILL SWITCH OFF"}
            </Badge>
            <Badge variant="info">Workflow: {data.workflowMode.toUpperCase()}</Badge>
            <Badge variant="info">Dashboard: {data.dashboardMode.toUpperCase()}</Badge>
          </div>

          <KeyValueList
            columns={2}
            items={[
              { key: "dbPath", label: "Database Path", value: data.dbPath, mono: true },
              { key: "configPath", label: "Config Path", value: data.configPath, mono: true },
            ]}
          />
        </div>
      </SectionFrame>

      <div className="grid gap-4 xl:grid-cols-2">
        {SECTIONS.map(({ key, title }) => (
          <SectionFrame key={key} title={title}>
            <pre className="overflow-x-auto p-4 text-xs text-[#A7AFBF]">
              {JSON.stringify(data[key], null, 2)}
            </pre>
          </SectionFrame>
        ))}
      </div>
    </div>
  );
}
