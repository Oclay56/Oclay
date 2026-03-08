"use client";

import { useMemo, useState } from "react";
import { useRunOptions, useRuntimeWorkflowActions, useSystemState } from "@/lib/hooks";
import { PageHeader } from "@/components/shell/PageHeader";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { StatusDot } from "@/components/ui/StatusDot";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatRelativeTime } from "@/lib/utils/time";
import { Database, Play, Server, Shield, Square } from "lucide-react";

export default function SystemPage() {
  const { data, isLoading, isError, error, refetch } = useSystemState();
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [preset, setPreset] = useState<string>("5");
  const [customBankrollInput, setCustomBankrollInput] = useState<string>("5");
  const [profileId, setProfileId] = useState<string>("auto");
  const [durationSecInput, setDurationSecInput] = useState<string>("0");
  const [actionMessage, setActionMessage] = useState<string>("");

  const bankrollUsd = useMemo(() => {
    if (preset === "custom") {
      const n = Number(customBankrollInput);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }
    const n = Number(preset);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [preset, customBankrollInput]);

  const {
    data: runOptions,
    isLoading: optionsLoading,
    isError: optionsError,
    error: optionsErrorValue,
  } = useRunOptions(bankrollUsd);
  const { startWorkflow, stopWorkflow, starting, stopping } = useRuntimeWorkflowActions();

  if (isLoading) {
    return <LoadingState message="Loading system state..." />;
  }

  if (isError) {
    return (
      <ErrorState
        title="Failed to load system state"
        description={error?.message}
        onRetry={refetch}
      />
    );
  }

  if (!data) {
    return <ErrorState title="No system data available" onRetry={refetch} />;
  }

  const profiles = runOptions?.profiles ?? [];
  const bankrollPresets = runOptions?.bankrollPresetsUsd ?? [5, 20, 35, 50];
  const recommended = runOptions?.recommendation ?? null;
  const durationSec = Number(durationSecInput);
  const normalizedDurationSec =
    Number.isFinite(durationSec) && durationSec > 0 ? Math.floor(durationSec) : undefined;
  const canStartLive = data.liveEnabled;
  const startDisabled =
    starting ||
    stopping ||
    (mode === "live" && !canStartLive) ||
    bankrollUsd === undefined ||
    bankrollUsd <= 0;
  const stopDisabled = starting || stopping || !data.botRunning;
  const solUsdPrice = data.baseAssetUsdPrice;
  const bankrollSol =
    bankrollUsd !== undefined &&
    Number.isFinite(bankrollUsd) &&
    bankrollUsd > 0 &&
    solUsdPrice !== undefined &&
    Number.isFinite(solUsdPrice) &&
    solUsdPrice > 0
      ? bankrollUsd / solUsdPrice
      : undefined;

  const formattedBankrollSol =
    bankrollSol === undefined
      ? "--"
      : bankrollSol >= 10
        ? bankrollSol.toFixed(2)
        : bankrollSol >= 1
          ? bankrollSol.toFixed(3)
          : bankrollSol >= 0.1
            ? bankrollSol.toFixed(4)
            : bankrollSol.toFixed(5);
  const formattedBankrollUsd = bankrollUsd === undefined ? "--" : bankrollUsd.toFixed(2);

  async function onStartClick(): Promise<void> {
    try {
      setActionMessage("");
      await startWorkflow({
        mode,
        bankrollUsd,
        profileId: profileId === "auto" ? undefined : profileId,
        durationSec: normalizedDurationSec,
      });
      await refetch();
      setActionMessage(
        `Started ${mode.toUpperCase()} workflow with ${profileId === "auto" ? "recommended profile" : profileId}.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionMessage(`Start failed: ${message}`);
    }
  }

  async function onStopClick(): Promise<void> {
    try {
      setActionMessage("");
      await stopWorkflow();
      await refetch();
      setActionMessage("Workflow stopped. Backend is now in observe mode.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionMessage(`Stop failed: ${message}`);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="System"
        description="Runtime configuration and workflow connectivity"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SectionFrame title="Workflow">
          <div className="flex items-center gap-3 p-4">
            <StatusDot status={data.botRunning ? "ok" : "warning"} pulsing={data.botRunning} size="lg" />
            <div className="space-y-1">
              <div className="text-sm font-medium text-[#F2F5FA]">
                {data.botRunning ? "Bot Running" : "No Bot Attached"}
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="info">{data.workflowMode.toUpperCase()}</Badge>
                <Badge variant={data.dashboardMode === "live" ? "danger" : "info"}>
                  {data.dashboardMode.toUpperCase()}
                </Badge>
              </div>
            </div>
          </div>
        </SectionFrame>

        <SectionFrame title="Runtime Feed">
          <div className="flex items-center gap-3 p-4">
            <StatusDot status={data.sseConnected ? "ok" : "danger"} pulsing={data.sseConnected} size="lg" />
            <div>
              <div className="text-sm font-medium text-[#F2F5FA]">
                {data.sseConnected ? "Connected" : "Disconnected"}
              </div>
              <div className="text-xs text-[#8B93A7]">
                {data.lastHeartbeatAtMs
                  ? `Last patch ${formatRelativeTime(data.lastHeartbeatAtMs)}`
                  : "No runtime patches yet"}
              </div>
            </div>
          </div>
        </SectionFrame>

        <SectionFrame title="Trading Mode">
          <div className="flex items-center gap-3 p-4">
            <StatusDot status={data.liveEnabled ? "danger" : "info"} size="lg" />
            <div className="space-y-1">
              <div className="text-sm font-medium text-[#F2F5FA]">
                {data.liveEnabled ? <Badge variant="danger">LIVE ENABLED</Badge> : <Badge variant="info">PAPER SAFE</Badge>}
              </div>
              <div className="text-xs text-[#8B93A7]">
                {data.liveEnabled ? "Real trades are permitted by env" : "Live trading is disabled"}
              </div>
            </div>
          </div>
        </SectionFrame>

        <SectionFrame title="Kill Switch">
          <div className="flex items-center gap-3 p-4">
            <StatusDot status={data.killSwitchActive ? "danger" : "ok"} size="lg" />
            <div className="space-y-1">
              <div className="text-sm font-medium text-[#F2F5FA]">
                {data.killSwitchActive ? <Badge variant="danger">ACTIVE</Badge> : <Badge variant="success">INACTIVE</Badge>}
              </div>
              <div className="text-xs text-[#8B93A7]">
                {data.killSwitchActive ? "New entries are blocked" : "Entries are allowed"}
              </div>
            </div>
          </div>
        </SectionFrame>
      </div>

      <SectionFrame title="Run Options">
        <div className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-[#8B93A7]">Mode</div>
              <Select value={mode} onValueChange={(value) => setMode(value as "paper" | "live")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paper">Paper</SelectItem>
                  <SelectItem value="live">Live</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-[#8B93A7]">Bankroll Preset</div>
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger>
                  <SelectValue placeholder="Preset" />
                </SelectTrigger>
                <SelectContent>
                  {bankrollPresets.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      ${value}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-[#8B93A7]">Custom Bankroll (USD)</div>
              <Input
                type="number"
                min={1}
                step="0.01"
                disabled={preset !== "custom"}
                value={customBankrollInput}
                onChange={(event) => setCustomBankrollInput(event.target.value)}
                className=""
                placeholder="e.g. 23.5"
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-[#8B93A7]">Profile</div>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Recommended)</SelectItem>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.label} - {profile.strategyStyle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-[#8B93A7]">Duration (sec)</div>
              <Input
                type="number"
                min={0}
                step={1}
                value={durationSecInput}
                onChange={(event) => setDurationSecInput(event.target.value)}
                className=""
                placeholder="0 = run until stopped"
              />
            </div>
          </div>

          <div className="oc-surface-soft rounded-md p-3 text-xs text-[#A7AFBF]">
            {optionsLoading && "Loading run presets and recommendations..."}
            {!optionsLoading && optionsError && `Failed to load runtime options: ${optionsErrorValue?.message ?? "unknown error"}`}
            {!optionsLoading && !optionsError && (
              <>
                <div>
                  Recommendation for {bankrollUsd === undefined ? "--" : `$${bankrollUsd.toFixed(2)}`}:{" "}
                  {recommended ? (
                    <span className="text-[#2EC3E5]">
                      {recommended.label} ({recommended.strategyStyle}) using {recommended.configPath}
                    </span>
                  ) : (
                    "--"
                  )}
                </div>
                {recommended?.summary && <div className="mt-1">{recommended.summary}</div>}
                {mode === "live" && !canStartLive && (
                  <div className="mt-1 text-[#F6B046]">
                    Live mode is disabled by env. Enable LIVE_TRADING and LIVE_TRADING_CONFIRM first.
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={onStartClick}
              disabled={startDisabled}
              className="bg-[#53B7FF] text-[#052035] hover:bg-[#79C8FF]"
            >
              <Play className="h-4 w-4" />
              {starting ? "Starting..." : `Run | ${formattedBankrollSol} SOL (~$${formattedBankrollUsd} USD)`}
            </Button>
            <Button
              onClick={onStopClick}
              disabled={stopDisabled}
              className="bg-[#2D3272] text-[#CAD6FF] hover:bg-[#3A3F86]"
            >
              <Square className="h-4 w-4" />
              {stopping ? "Stopping..." : "Stop Workflow"}
            </Button>
          </div>

          {actionMessage && (
            <div className="text-xs text-[#8B93A7]">{actionMessage}</div>
          )}
        </div>
      </SectionFrame>

      <SectionFrame title="Runtime Configuration">
        <div className="p-4">
          <KeyValueList
            columns={2}
            items={[
              {
                key: "dbPath",
                label: "Database Path",
                value: (
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-[#8B93A7]" />
                    <span className="font-mono text-xs">{data.dbPath}</span>
                  </div>
                ),
              },
              {
                key: "configPath",
                label: "Config Path",
                value: <span className="font-mono text-xs">{data.configPath}</span>,
              },
              {
                key: "rpcUrl",
                label: "RPC URL",
                value: (
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-[#8B93A7]" />
                    <span className="font-mono text-xs">{data.rpcUrl}</span>
                  </div>
                ),
              },
              {
                key: "rpcConcurrency",
                label: "RPC Concurrency",
                value: <span className="font-mono text-xs">{data.rpcConcurrency}</span>,
              },
              {
                key: "rpcIntervalCap",
                label: "RPC Interval Cap",
                value: <span className="font-mono text-xs">{data.rpcIntervalCap ?? "--"}</span>,
              },
              {
                key: "rpcIntervalMs",
                label: "RPC Interval Ms",
                value: <span className="font-mono text-xs">{data.rpcIntervalMs ?? "--"}</span>,
              },
              {
                key: "helius",
                label: "Helius WS",
                value: data.heliusPresent ? "Configured" : "Missing",
              },
              {
                key: "subscribers",
                label: "SSE Subscribers",
                value: <span className="font-mono text-xs">{data.runtimeSubscribers}</span>,
              },
              {
                key: "botStarted",
                label: "Bot Started",
                value: data.botStartedAtMs ? formatRelativeTime(data.botStartedAtMs) : "--",
              },
              {
                key: "botStopped",
                label: "Bot Stopped",
                value: data.botStoppedAtMs ? formatRelativeTime(data.botStoppedAtMs) : "--",
              },
              {
                key: "dashboardLogLevel",
                label: "Dashboard Log Level",
                value: data.dashboardLogLevel,
              },
              {
                key: "dashboardLogTarget",
                label: "Dashboard Log Target",
                value: data.dashboardLogTarget,
              },
            ]}
          />
        </div>
      </SectionFrame>

      <div className="rounded-lg border border-[#F6B046]/30 bg-[#F6B046]/5 p-4">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#F6B046]" />
          <div>
            <h3 className="text-sm font-medium text-[#F6B046]">Security Notice</h3>
            <p className="mt-1 text-xs text-[#A7AFBF]">
              Secrets and private keys are never exposed to the dashboard. This UI only receives
              filtered operational state from the local backend.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
