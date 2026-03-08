"use client";

import { cn } from "@/lib/utils";
import { Sell429Display } from "@/lib/types";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { Badge } from "@/components/ui/Badge";
import { formatCountdown, formatMint } from "@/lib/utils";
import { AlertTriangle, Clock } from "lucide-react";

interface Sell429CardProps {
  sell429: Sell429Display;
  className?: string;
}

export function Sell429Card({ sell429, className }: Sell429CardProps) {
  return (
    <SectionFrame title="Sell 429 Cooldowns" className={className}>
      <div className="space-y-3">
        {/* Global cooldown */}
        <div className="oc-surface-soft flex items-center justify-between rounded-lg p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className={cn(
              "h-4 w-4",
              sell429.globalActive ? "text-[#F6B046]" : "text-[#8B93A7]"
            )} />
            <span className="text-sm text-[#F2F5FA]">Global Cooldown</span>
          </div>
          {sell429.globalActive ? (
            <Badge variant="warning">
              <Clock className="mr-1 h-3 w-3" />
              {formatCountdown(sell429.globalCooldownUntilMs)}
            </Badge>
          ) : (
            <Badge variant="success">Inactive</Badge>
          )}
        </div>

        {/* Per-mint cooldowns */}
        {sell429.perMint.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs text-[#8B93A7]">Per-Mint Cooldowns</div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {sell429.perMint.map((item) => (
                <div key={item.mint} className="oc-surface-soft flex items-center justify-between rounded px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#A7AFBF]">
                      {formatMint(item.mint)}
                    </span>
                    <Badge variant="warning" size="sm">
                      {item.streak} strikes
                    </Badge>
                  </div>
                  <span className="text-xs text-[#F6B046]">
                    {formatCountdown(item.cooldownUntilMs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-3 text-xs text-[#8B93A7]">
            No per-mint cooldowns active
          </div>
        )}
      </div>
    </SectionFrame>
  );
}
