"use client";

import { cn } from "@/lib/utils";
import { FocusState } from "@/lib/types";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExternalLinkButton } from "@/components/ui/ExternalLinkButton";
import { getSolscanTokenUrl, getDexScreenerUrl } from "@/lib/utils/links";
import { formatMint, formatRelativeTime, getScoreBg, getPositionStatusBadge, getSideBadge, getExecutionResultBadge } from "@/lib/utils";
import { Target, AlertTriangle, TrendingUp, Ban, Clock } from "lucide-react";

interface FocusMintPanelProps {
  focus: FocusState | null;
  className?: string;
}

export function FocusMintPanel({ focus, className }: FocusMintPanelProps) {
  if (!focus) {
    return (
      <SectionFrame title="Focus Mint" className={className}>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="oc-surface-soft mb-3 rounded-full p-3">
            <Target className="h-6 w-6 text-[#8B93A7]" />
          </div>
          <p className="text-sm text-[#8B93A7]">No focus mint selected</p>
          <p className="mt-1 text-xs text-[#8B93A7]">
            Focus will appear when there&apos;s an open position, recent failure, or latest risk report
          </p>
        </div>
      </SectionFrame>
    );
  }

  const reasonLabels: Record<string, string> = {
    cli_focus: "CLI Focus",
    open_position: "Open Position",
    recent_failure: "Recent Failure",
    latest_risk: "Latest Risk",
  };

  return (
    <SectionFrame
      title={
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-[#2EC3E5]" />
          <span>Focus Mint</span>
          <Badge variant="info" size="sm">{reasonLabels[focus.reason]}</Badge>
        </div>
      }
      className={className}
    >
      <div className="space-y-4">
        {/* Mint header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-[#F2F5FA]">
              {formatMint(focus.mint)}
            </span>
            <CopyButton text={focus.mint} />
            <ExternalLinkButton href={getSolscanTokenUrl(focus.mint)} />
            <ExternalLinkButton href={getDexScreenerUrl(focus.mint)} />
          </div>
        </div>

        {/* Risk info */}
        {focus.risk && (
          <div className="oc-surface-soft rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-[#F6B046]" />
              <span className="text-xs font-medium text-[#A7AFBF]">Risk Report</span>
              <span className="text-xs text-[#8B93A7]">
                {formatRelativeTime(focus.risk.createdAtMs)}
              </span>
            </div>
            <div className="flex gap-2">
              <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-medium", getScoreBg(focus.risk.riskScore))}>
                Risk: {focus.risk.riskScore}
              </span>
              <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-medium", getScoreBg(focus.risk.tradeScore))}>
                Trade: {focus.risk.tradeScore}
              </span>
            </div>
            {focus.risk.flags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {focus.risk.flags.map((flag) => (
                  <span
                    key={flag}
                    className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#F6B046]/15 text-[#F6B046]"
                  >
                    {flag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Position info */}
        {focus.position && (
          <div className="oc-surface-soft rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-[#27C587]" />
              <span className="text-xs font-medium text-[#A7AFBF]">Position</span>
              {(() => {
                const badge = getPositionStatusBadge(focus.position!.status);
                return (
                  <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", badge.bg, badge.text)}>
                    {badge.label}
                  </span>
                );
              })()}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[#8B93A7]">Opened: </span>
                <span className="text-[#A7AFBF]">{formatRelativeTime(focus.position.openedAtMs)}</span>
              </div>
              <div>
                <span className="text-[#8B93A7]">Entry: </span>
                <span className="font-mono text-[#A7AFBF]">{focus.position.entryPriceUsd ? `$${focus.position.entryPriceUsd}` : "â€”"}</span>
              </div>
            </div>
          </div>
        )}

        {/* Execution info */}
        {focus.execution && (
          <div className="oc-surface-soft rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              {(() => {
                const badge = getSideBadge(focus.execution!.side);
                return (
                  <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", badge.bg, badge.text)}>
                    {badge.label}
                  </span>
                );
              })()}
              <span className="text-xs text-[#8B93A7]">
                {formatRelativeTime(focus.execution.requestedAtMs)}
              </span>
              {(() => {
                const badge = getExecutionResultBadge(focus.execution!.ok, focus.execution!.err);
                return (
                  <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", badge.bg, badge.text)}>
                    {badge.label}
                  </span>
                );
              })()}
            </div>
            {focus.execution.err && (
              <p className="text-xs text-[#F24E4E]">{focus.execution.err}</p>
            )}
          </div>
        )}

        {/* Block info */}
        {focus.block && (
          <div className="rounded-lg bg-[#F24E4E]/5 border border-[#F24E4E]/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Ban className="h-4 w-4 text-[#F24E4E]" />
              <span className="text-xs font-medium text-[#F24E4E]">Blocked</span>
              <span className="text-xs text-[#F24E4E]/70">{focus.block.reason}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-[#F24E4E]">
              <Clock className="h-3 w-3" />
              Expires {formatRelativeTime(focus.block.expiresAtMs)}
            </div>
          </div>
        )}

        {/* Sell429 info */}
        {focus.sell429 && (
          <div className="rounded-lg bg-[#F6B046]/5 border border-[#F6B046]/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-[#F6B046]" />
              <span className="text-xs font-medium text-[#F6B046]">Cooldown</span>
              <Badge variant="warning" size="sm">{focus.sell429.streak} strikes</Badge>
            </div>
            <div className="text-xs text-[#F6B046]">
              Cooldown until {formatRelativeTime(focus.sell429.cooldownUntilMs)}
            </div>
          </div>
        )}
      </div>
    </SectionFrame>
  );
}
