"use client";

import { cn } from "@/lib/utils";
import { TokenRiskReport } from "@/lib/types";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExternalLinkButton } from "@/components/ui/ExternalLinkButton";
import { getSolscanTokenUrl, getDexScreenerUrl } from "@/lib/utils/links";
import { formatMint, formatUsd, formatPercent, formatBps, getScoreBg } from "@/lib/utils";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Check, X, AlertTriangle } from "lucide-react";

interface AnalyzeReportViewProps {
  report: TokenRiskReport;
  className?: string;
}

export function AnalyzeReportView({ report, className }: AnalyzeReportViewProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-medium text-[#F2F5FA]">
            {formatMint(report.mint, 10)}
          </span>
          <CopyButton text={report.mint} />
          <ExternalLinkButton href={getSolscanTokenUrl(report.mint)} />
          <ExternalLinkButton href={getDexScreenerUrl(report.mint)} />
        </div>
        <div className="flex items-center gap-2">
          {report.canExitRoute ? (
            <Badge variant="success">
              <Check className="mr-1 h-3 w-3" />
              Can Exit
            </Badge>
          ) : (
            <Badge variant="danger">
              <X className="mr-1 h-3 w-3" />
              No Exit
            </Badge>
          )}
        </div>
      </div>

      {/* Scores */}
      <SectionFrame title="Risk Scores">
        <div className="grid grid-cols-3 gap-4">
          <div className="oc-surface-soft rounded-lg p-4 text-center">
            <div className={cn("inline-flex rounded px-4 py-2 text-2xl font-bold", getScoreBg(report.riskScore))}>
              {report.riskScore}
            </div>
            <div className="mt-2 text-xs text-[#8B93A7]">Risk Score</div>
            <div className="text-[10px] text-[#8B93A7]">Lower is better</div>
          </div>
          <div className="oc-surface-soft rounded-lg p-4 text-center">
            <div className={cn("inline-flex rounded px-4 py-2 text-2xl font-bold", getScoreBg(report.opportunityScore))}>
              {report.opportunityScore}
            </div>
            <div className="mt-2 text-xs text-[#8B93A7]">Opportunity</div>
            <div className="text-[10px] text-[#8B93A7]">Higher is better</div>
          </div>
          <div className="oc-surface-soft rounded-lg p-4 text-center">
            <div className={cn("inline-flex rounded px-4 py-2 text-2xl font-bold", getScoreBg(report.tradeScore))}>
              {report.tradeScore}
            </div>
            <div className="mt-2 text-xs text-[#8B93A7]">Trade Score</div>
            <div className="text-[10px] text-[#8B93A7]">Combined metric</div>
          </div>
        </div>
      </SectionFrame>

      {/* Key Metrics */}
      <SectionFrame title="Key Metrics">
        <KeyValueList
          columns={2}
          items={[
            {
              key: "liquidity",
              label: "Liquidity USD",
              value: formatUsd(report.liquidityUsd, { compact: true }),
              mono: true,
            },
            {
              key: "volume",
              label: "24h Volume USD",
              value: formatUsd(report.volumeH24Usd, { compact: true }),
              mono: true,
            },
            {
              key: "marketAge",
              label: "Market Age",
              value: report.marketAgeMinutes
                ? `${Math.floor(report.marketAgeMinutes / 60)}h ${report.marketAgeMinutes % 60}m`
                : "â€”",
              mono: true,
            },
            {
              key: "priceImpact",
              label: "Price Impact",
              value: report.priceImpactPct ? formatPercent(report.priceImpactPct / 100) : "â€”",
              mono: true,
            },
            {
              key: "top1Holder",
              label: "Top 1 Holder",
              value: report.top1HolderPct ? formatPercent(report.top1HolderPct / 100) : "â€”",
              mono: true,
            },
            {
              key: "top10Holders",
              label: "Top 10 Holders",
              value: report.top10HolderPct ? formatPercent(report.top10HolderPct / 100) : "â€”",
              mono: true,
            },
            {
              key: "roundTripLoss",
              label: "Round-trip Loss",
              value: report.impliedRoundTripLossBps ? formatBps(report.impliedRoundTripLossBps) : "â€”",
              mono: true,
            },
            {
              key: "canExit",
              label: "Exit Route",
              value: report.canExitRoute ? "Available" : "Unavailable",
              mono: true,
            },
          ]}
        />
      </SectionFrame>

      {/* Flags */}
      {report.flags.length > 0 && (
        <SectionFrame
          title={
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[#F6B046]" />
              <span>Warning Flags</span>
            </div>
          }
        >
          <div className="flex flex-wrap gap-2">
            {report.flags.map((flag) => (
              <span
                key={flag}
                className={cn(
                  "inline-flex rounded px-3 py-1.5 text-sm font-medium",
                  flag.includes("EXIT") || flag.includes("DRAIN") || flag.includes("FAIL")
                    ? "bg-[#F24E4E]/15 text-[#F24E4E]"
                    : "bg-[#F6B046]/15 text-[#F6B046]"
                )}
              >
                {flag}
              </span>
            ))}
          </div>
        </SectionFrame>
      )}

      {/* Reasons */}
      {report.reasons.length > 0 && (
        <SectionFrame title="Analysis Reasons">
          <ul className="space-y-2">
            {report.reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[#A7AFBF]">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#2EC3E5] flex-shrink-0" />
                {reason}
              </li>
            ))}
          </ul>
        </SectionFrame>
      )}

      {/* Raw Metrics */}
      <SectionFrame title="Raw Metrics">
        <pre className="oc-surface-soft overflow-x-auto rounded p-2 text-xs text-[#8B93A7]">
          {JSON.stringify(report.metrics, null, 2)}
        </pre>
      </SectionFrame>
    </div>
  );
}
