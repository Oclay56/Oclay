"use client";

import { cn } from "@/lib/utils";
import { StreamHealth } from "@/lib/types";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { StatusDot } from "@/components/ui/StatusDot";
import { formatRelativeTime } from "@/lib/utils/time";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react";

interface StreamHealthCardProps {
  streamHealth: StreamHealth;
  className?: string;
}

export function StreamHealthCard({ streamHealth, className }: StreamHealthCardProps) {
  const getStatus = () => {
    if (!streamHealth.enabled) return { label: "Disabled", status: "neutral" as const, icon: WifiOff };
    if (!streamHealth.connected) return { label: "Disconnected", status: "danger" as const, icon: WifiOff };
    if (streamHealth.stale) return { label: "Stale", status: "warning" as const, icon: AlertTriangle };
    if (streamHealth.fallbackActive) return { label: "Fallback", status: "warning" as const, icon: AlertTriangle };
    return { label: "Connected", status: "ok" as const, icon: Wifi };
  };

  const status = getStatus();
  const StatusIcon = status.icon;

  return (
    <SectionFrame title="Stream Health" className={className}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot status={status.status} pulsing={status.status === "ok"} />
            <span className="text-sm font-medium text-[#F2F5FA]">{status.label}</span>
          </div>
          <StatusIcon className={cn("h-5 w-5", 
            status.status === "ok" ? "text-[#27C587]" :
            status.status === "warning" ? "text-[#F6B046]" :
            status.status === "danger" ? "text-[#F24E4E]" :
            "text-[#8B93A7]"
          )} />
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-[#8B93A7]">Enabled</span>
            <span className={streamHealth.enabled ? "text-[#27C587]" : "text-[#8B93A7]"}>
              {streamHealth.enabled ? "Yes" : "No"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8B93A7]">Connected</span>
            <span className={streamHealth.connected ? "text-[#27C587]" : "text-[#F24E4E]"}>
              {streamHealth.connected ? "Yes" : "No"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8B93A7]">Stale</span>
            <span className={streamHealth.stale ? "text-[#F6B046]" : "text-[#27C587]"}>
              {streamHealth.stale ? "Yes" : "No"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8B93A7]">Fallback</span>
            <span className={streamHealth.fallbackActive ? "text-[#F6B046]" : "text-[#27C587]"}>
              {streamHealth.fallbackActive ? "Active" : "Inactive"}
            </span>
          </div>
          {streamHealth.lastEventAtMs && (
            <div className="flex justify-between">
              <span className="text-[#8B93A7]">Last Event</span>
              <span className="text-[#A7AFBF]">
                {formatRelativeTime(streamHealth.lastEventAtMs)}
              </span>
            </div>
          )}
        </div>
      </div>
    </SectionFrame>
  );
}
