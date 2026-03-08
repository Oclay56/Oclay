"use client";

import { cn } from "@/lib/utils";
import { Alert } from "@/lib/types";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { Badge } from "@/components/ui/Badge";
import { getSeverityBadge } from "@/lib/utils/badges";
import { formatRelativeTime, formatMint, formatCountdown } from "@/lib/utils";
import { AlertTriangle, AlertCircle, Clock } from "lucide-react";

interface AlertCardProps {
  alerts: Alert[];
  className?: string;
}

export function AlertCard({ alerts, className }: AlertCardProps) {
  const criticalAlerts = alerts.filter((a) => a.severity === "CRITICAL");
  const warningAlerts = alerts.filter((a) => a.severity === "WARN");

  return (
    <SectionFrame
      title={
        <div className="flex items-center gap-2">
          <span>Alerts</span>
          {criticalAlerts.length > 0 && (
            <Badge variant="danger">{criticalAlerts.length}</Badge>
          )}
          {warningAlerts.length > 0 && (
            <Badge variant="warning">{warningAlerts.length}</Badge>
          )}
        </div>
      }
      className={className}
    >
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="mb-2 rounded-full bg-[#27C587]/15 p-2">
            <AlertCircle className="h-5 w-5 text-[#27C587]" />
          </div>
          <p className="text-sm text-[#8B93A7]">No active alerts</p>
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-2">
          {alerts.map((alert, index) => {
            const severityBadge = getSeverityBadge(alert.severity);
            const AlertIcon = alert.severity === "CRITICAL" ? AlertTriangle : AlertCircle;

            return (
              <div
                key={`${alert.code}-${alert.mint}-${index}`}
                className={cn(
                  "rounded-lg border p-3",
                  alert.severity === "CRITICAL"
                    ? "border-[#F24E4E]/30 bg-[#F24E4E]/5"
                    : "border-[#F6B046]/30 bg-[#F6B046]/5"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertIcon className={cn(
                      "h-4 w-4 flex-shrink-0",
                      alert.severity === "CRITICAL" ? "text-[#F24E4E]" : "text-[#F6B046]"
                    )} />
                    <span className={cn(
                      "text-xs font-medium uppercase",
                      severityBadge.text
                    )}>
                      {alert.code}
                    </span>
                  </div>
                  <Badge variant={alert.severity === "CRITICAL" ? "danger" : "warning"} size="sm">
                    {alert.count}x
                  </Badge>
                </div>

                <p className="mt-2 text-sm text-[#F2F5FA]">{alert.summary}</p>

                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="font-mono text-[#8B93A7]">
                    {formatMint(alert.mint)}
                  </span>
                  <span className="text-[#A7AFBF]">
                    {formatRelativeTime(alert.lastSeenAtMs)}
                  </span>
                </div>

                {alert.retryAtMs && alert.retryAtMs > Date.now() && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-[#F6B046]">
                    <Clock className="h-3 w-3" />
                    Retry in {formatCountdown(alert.retryAtMs)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionFrame>
  );
}
