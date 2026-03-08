"use client";

import { cn } from "@/lib/utils";
import { CapitalState } from "@/lib/types";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { formatUsd, getPnlColor } from "@/lib/utils";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { TrendingUp, TrendingDown, Wallet, DollarSign } from "lucide-react";

interface PnlSummaryPanelProps {
  capital: CapitalState;
  className?: string;
}

export function PnlSummaryPanel({ capital, className }: PnlSummaryPanelProps) {
  const deployed = capital.deployedUsd || 0;
  const reserved = capital.pendingReservedEntryUsd || 0;

  const pieData = [
    { name: "Realized PnL", value: capital.realizedPnlUsd || 0, color: (capital.realizedPnlUsd || 0) >= 0 ? "#27C587" : "#F24E4E" },
    { name: "Unrealized PnL", value: Math.abs(capital.unrealizedPnlUsd || 0), color: (capital.unrealizedPnlUsd || 0) >= 0 ? "#2EC3E5" : "#F6B046" },
    { name: "Deployed", value: deployed, color: "#8B93A7" },
    { name: "Reserved", value: reserved, color: "#A7AFBF" },
  ].filter((d) => d.value > 0);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="oc-surface rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#8B93A7]">
            <TrendingUp className="h-3 w-3" />
            Realized PnL
          </div>
          <div className={cn("mt-1 text-lg font-mono font-semibold", getPnlColor(capital.realizedPnlUsd))}>
            {formatUsd(capital.realizedPnlUsd, { showSign: true })}
          </div>
        </div>

        <div className="oc-surface rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#8B93A7]">
            <TrendingDown className="h-3 w-3" />
            Unrealized PnL
          </div>
          <div className={cn("mt-1 text-lg font-mono font-semibold", getPnlColor(capital.unrealizedPnlUsd))}>
            {formatUsd(capital.unrealizedPnlUsd, { showSign: true })}
          </div>
        </div>

        <div className="oc-surface rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#8B93A7]">
            <Wallet className="h-3 w-3" />
            Deployed
          </div>
          <div className="mt-1 text-lg font-mono font-semibold text-[#F2F5FA]">
            {formatUsd(capital.deployedUsd)}
          </div>
        </div>

        <div className="oc-surface rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#8B93A7]">
            <DollarSign className="h-3 w-3" />
            SOL Price
          </div>
          <div className="mt-1 text-lg font-mono font-semibold text-[#2EC3E5]">
            {formatUsd(capital.baseAssetUsdPrice)}
          </div>
        </div>
      </div>

      {/* Chart */}
      <SectionFrame title="Capital Allocation">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={70}
                paddingAngle={2}
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#111318",
                  border: "1px solid rgba(142,152,169,0.12)",
                  borderRadius: "6px",
                }}
                labelStyle={{ color: "#F2F5FA" }}
                itemStyle={{ color: "#A7AFBF" }}
                formatter={(value: number) => formatUsd(value)}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap justify-center gap-4">
          {pieData.map((item) => (
            <div key={item.name} className="flex items-center gap-1.5">
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-xs text-[#A7AFBF]">{item.name}</span>
            </div>
          ))}
        </div>
      </SectionFrame>
    </div>
  );
}
