"use client";

import { cn } from "@/lib/utils";
import { LatencyMetrics } from "@/lib/types";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface LatencyPanelProps {
  latency: LatencyMetrics;
  history?: Array<{
    timestamp: number;
    detectToIntentP50: number;
    detectToIntentP95: number;
    sentToConfirmedP50: number;
    sentToConfirmedP95: number;
  }>;
  className?: string;
}

function formatLatencyMs(value: number | null | undefined): string {
  return value === null || value === undefined ? "--" : `${value}ms`;
}

export function LatencyPanel({ latency, history = [], className }: LatencyPanelProps) {
  const chartData = history.map((entry) => ({
    time: new Date(entry.timestamp).toLocaleTimeString(),
    detectP50: entry.detectToIntentP50,
    detectP95: entry.detectToIntentP95,
    sentP50: entry.sentToConfirmedP50,
    sentP95: entry.sentToConfirmedP95,
  }));

  const emptyHistory = (
    <EmptyState
      title="No latency history"
      description="Historical latency points are not persisted yet. The KPI values above are live aggregates from the database."
      className="py-10"
    />
  );

  return (
    <div className={cn("space-y-4", className)}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="oc-surface rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wide text-[#8B93A7]">Detect to Intent P50</div>
          <div className="mt-1 text-lg font-mono font-semibold text-[#2EC3E5]">
            {formatLatencyMs(latency.detectToIntentMs.p50)}
          </div>
        </div>
        <div className="oc-surface rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wide text-[#8B93A7]">Detect to Intent P95</div>
          <div className="mt-1 text-lg font-mono font-semibold text-[#F6B046]">
            {formatLatencyMs(latency.detectToIntentMs.p95)}
          </div>
        </div>
        <div className="oc-surface rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wide text-[#8B93A7]">Sent to Confirmed P50</div>
          <div className="mt-1 text-lg font-mono font-semibold text-[#27C587]">
            {formatLatencyMs(latency.sentToConfirmedMs.p50)}
          </div>
        </div>
        <div className="oc-surface rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wide text-[#8B93A7]">Sent to Confirmed P95</div>
          <div className="mt-1 text-lg font-mono font-semibold text-[#F24E4E]">
            {formatLatencyMs(latency.sentToConfirmedMs.p95)}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionFrame title="Detect to Intent">
          {chartData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(142,152,169,0.12)" />
                  <XAxis dataKey="time" tick={{ fill: "#8B93A7", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#8B93A7", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#111318",
                      border: "1px solid rgba(142,152,169,0.12)",
                      borderRadius: "6px",
                    }}
                    labelStyle={{ color: "#F2F5FA" }}
                    itemStyle={{ color: "#A7AFBF" }}
                  />
                  <Line type="monotone" dataKey="detectP50" stroke="#2EC3E5" strokeWidth={2} dot={false} name="P50" />
                  <Line type="monotone" dataKey="detectP95" stroke="#F6B046" strokeWidth={2} dot={false} name="P95" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            emptyHistory
          )}
        </SectionFrame>

        <SectionFrame title="Sent to Confirmed">
          {chartData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(142,152,169,0.12)" />
                  <XAxis dataKey="time" tick={{ fill: "#8B93A7", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#8B93A7", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#111318",
                      border: "1px solid rgba(142,152,169,0.12)",
                      borderRadius: "6px",
                    }}
                    labelStyle={{ color: "#F2F5FA" }}
                    itemStyle={{ color: "#A7AFBF" }}
                  />
                  <Line type="monotone" dataKey="sentP50" stroke="#27C587" strokeWidth={2} dot={false} name="P50" />
                  <Line type="monotone" dataKey="sentP95" stroke="#F24E4E" strokeWidth={2} dot={false} name="P95" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            emptyHistory
          )}
        </SectionFrame>
      </div>

      <div className="oc-surface-soft flex items-center justify-between rounded-lg px-4 py-2">
        <span className="text-xs text-[#8B93A7]">Sample Size</span>
        <div className="flex gap-4 text-xs">
          <span className="text-[#A7AFBF]">
            Total: <span className="font-mono text-[#F2F5FA]">{latency.sampleSize.toLocaleString()}</span>
          </span>
          <span className="text-[#A7AFBF]">
            Detect to Intent: <span className="font-mono text-[#F2F5FA]">{latency.detectToIntentSamples.toLocaleString()}</span>
          </span>
          <span className="text-[#A7AFBF]">
            Sent to Confirmed: <span className="font-mono text-[#F2F5FA]">{latency.sentToConfirmedSamples.toLocaleString()}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
