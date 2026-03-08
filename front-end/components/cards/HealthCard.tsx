"use client";

import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/StatusDot";

interface HealthCardProps {
  title: string;
  status: "ok" | "warning" | "danger" | "info";
  message: string;
  details?: string;
  className?: string;
}

export function HealthCard({
  title,
  status,
  message,
  details,
  className,
}: HealthCardProps) {
  const statusBg = {
    ok: "bg-[#27C587]/5 border-[#27C587]/30",
    warning: "bg-[#F6B046]/5 border-[#F6B046]/30",
    danger: "bg-[#F24E4E]/5 border-[#F24E4E]/30",
    info: "bg-[#2EC3E5]/5 border-[#2EC3E5]/30",
  };

  return (
    <div
      className={cn(
        "rounded-[10px] border p-4",
        "shadow-[0_10px_30px_rgba(0,0,0,0.35)]",
        statusBg[status],
        className
      )}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={status} size="md" pulsing={status === "ok"} />
        <span className="text-sm font-medium text-[#F2F5FA]">{title}</span>
      </div>
      <p className="mt-2 text-sm text-[#A7AFBF]">{message}</p>
      {details && <p className="mt-1 text-xs text-[#8B93A7]">{details}</p>}
    </div>
  );
}
