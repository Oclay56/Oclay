"use client";

import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/utils/format";

interface StatCardProps {
  label: string;
  value: number | string;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  variant?: "default" | "warning" | "danger" | "success";
  className?: string;
}

export function StatCard({
  label,
  value,
  subValue,
  trend,
  variant = "default",
  className,
}: StatCardProps) {
  const variants = {
    default: "",
    warning: "border-[#F6B046]/30",
    danger: "border-[#F24E4E]/30",
    success: "border-[#27C587]/30",
  };

  const trendColors = {
    up: "text-[#27C587]",
    down: "text-[#F24E4E]",
    neutral: "text-[#8B93A7]",
  };

  return (
    <div
      className={cn(
        "oc-surface rounded-lg p-4 card-hover",
        variants[variant],
        className
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-[#8B93A7]">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[1.85rem] font-bold tracking-tight text-[#F2F5FA]">
          {typeof value === "number" ? formatNumber(value) : value}
        </span>
        {subValue && (
          <span className={cn("text-xs", trend ? trendColors[trend] : "text-[#8B93A7]")}>
            {subValue}
          </span>
        )}
      </div>
    </div>
  );
}
