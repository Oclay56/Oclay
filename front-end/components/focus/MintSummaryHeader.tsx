"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExternalLinkButton } from "@/components/ui/ExternalLinkButton";
import { getSolscanTokenUrl, getDexScreenerUrl } from "@/lib/utils/links";
import { formatMint, getScoreBg } from "@/lib/utils";

interface MintSummaryHeaderProps {
  mint: string;
  riskScore?: number;
  tradeScore?: number;
  hasPosition?: boolean;
  className?: string;
}

export function MintSummaryHeader({
  mint,
  riskScore,
  tradeScore,
  hasPosition,
  className,
}: MintSummaryHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4",
        "oc-surface-soft rounded-lg p-3",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm font-medium text-[#F2F5FA]">
          {formatMint(mint, 8)}
        </span>
        <CopyButton text={mint} />
        <ExternalLinkButton href={getSolscanTokenUrl(mint)} size="sm" />
        <ExternalLinkButton href={getDexScreenerUrl(mint)} size="sm" />
      </div>

      <div className="flex items-center gap-2">
        {hasPosition && (
          <Badge variant="success" size="sm">POSITION</Badge>
        )}
        {riskScore !== undefined && (
          <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-medium", getScoreBg(riskScore))}>
            R:{riskScore}
          </span>
        )}
        {tradeScore !== undefined && (
          <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-medium", getScoreBg(tradeScore))}>
            T:{tradeScore}
          </span>
        )}
      </div>
    </div>
  );
}
