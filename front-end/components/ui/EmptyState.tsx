"use client";

import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title?: string;
  description?: string;
  className?: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  surface?: boolean;
}

export function EmptyState({
  title = "No data",
  description = "There's nothing to display here yet.",
  className,
  hint,
  action,
  icon: Icon = Inbox,
  surface = true,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-4 py-12",
        "text-center",
        surface && "oc-empty-panel rounded-[18px]",
        className
      )}
    >
      <div className="oc-surface-soft mb-4 rounded-full p-3">
        <Icon className="h-6 w-6 text-[#76D6F2]" />
      </div>
      <h3 className="text-base font-semibold tracking-[-0.02em] text-[#F2F5FA]">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-[#8B93A7]">{description}</p>
      {hint && <p className="mt-3 text-xs text-[#697284]">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
