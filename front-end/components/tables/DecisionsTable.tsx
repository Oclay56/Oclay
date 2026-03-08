"use client";

import { cn } from "@/lib/utils";
import { Decision } from "@/lib/types";
import { formatMint, formatRelativeTime } from "@/lib/utils";
import { getDecisionKindBadge, getWorkflowPhaseBadge } from "@/lib/utils/badges";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExternalLinkButton } from "@/components/ui/ExternalLinkButton";
import { getSolscanTokenUrl } from "@/lib/utils/links";

interface DecisionsTableProps {
  decisions: Decision[];
  className?: string;
}

export function DecisionsTable({ decisions, className }: DecisionsTableProps) {
  if (!decisions.length) {
    return <div className="p-4 text-sm text-[#8B93A7]">No recent decision reasons yet.</div>;
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-[rgba(142,152,169,0.12)]">
            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[#8B93A7]">Time</th>
            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[#8B93A7]">Decision</th>
            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[#8B93A7]">Phase</th>
            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[#8B93A7]">Mint</th>
            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[#8B93A7]">Reason</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((decision) => {
            const kindBadge = getDecisionKindBadge(decision.decisionKind);
            const phaseBadge = getWorkflowPhaseBadge(decision.workflowPhase);
            return (
              <tr
                key={`${decision.atMs}:${decision.mint}:${decision.stage}:${decision.intentId ?? decision.candidateId ?? ""}`}
                className="border-b border-[rgba(142,152,169,0.08)] hover:bg-[#171A21]/50 transition-colors"
              >
                <td className="px-3 py-2.5 text-xs text-[#A7AFBF]">{formatRelativeTime(decision.atMs)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col gap-1">
                    <span className={cn("inline-flex w-fit rounded px-2 py-0.5 text-[10px] font-medium uppercase", kindBadge.bg, kindBadge.text)}>
                      {kindBadge.label}
                    </span>
                    <span className="font-mono text-[11px] text-[#8B93A7]">{decision.stage}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {decision.workflowPhase ? (
                    <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", phaseBadge.bg, phaseBadge.text)}>
                      {phaseBadge.label}
                    </span>
                  ) : (
                    <span className="text-xs text-[#8B93A7]">--</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#F2F5FA]">{formatMint(decision.mint)}</span>
                    <CopyButton text={decision.mint} size="sm" />
                    <ExternalLinkButton href={getSolscanTokenUrl(decision.mint)} size="sm" />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-xs text-[#D9DEE8]" title={decision.reason}>
                    {decision.reason || "--"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
