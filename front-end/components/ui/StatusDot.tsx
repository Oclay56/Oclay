"use client";

import { cn } from "@/lib/utils";

interface StatusDotProps {
  status: "ok" | "warning" | "danger" | "info" | "neutral";
  size?: "sm" | "md" | "lg";
  pulsing?: boolean;
  className?: string;
}

export function StatusDot({
  status,
  size = "sm",
  pulsing = false,
  className,
}: StatusDotProps) {
  const colors = {
    ok: "bg-[#27C587]",
    warning: "bg-[#F6B046]",
    danger: "bg-[#F24E4E]",
    info: "bg-[#2EC3E5]",
    neutral: "bg-[#8B93A7]",
  };

  const sizes = {
    sm: "w-1.5 h-1.5",
    md: "w-2 h-2",
    lg: "w-2.5 h-2.5",
  };

  return (
    <span
      className={cn(
        "inline-block rounded-full",
        colors[status],
        sizes[size],
        pulsing && "animate-pulse",
        className
      )}
    />
  );
}

interface StatusIndicatorProps {
  label: string;
  status: "ok" | "warning" | "danger" | "info" | "neutral";
  pulsing?: boolean;
  className?: string;
}

export function StatusIndicator({
  label,
  status,
  pulsing,
  className,
}: StatusIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <StatusDot status={status} pulsing={pulsing} />
      <span className="text-xs text-[#A7AFBF]">{label}</span>
    </div>
  );
}
