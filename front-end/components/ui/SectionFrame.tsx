"use client";

import { cn } from "@/lib/utils";

interface SectionFrameProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  noPadding?: boolean;
}

export function SectionFrame({
  children,
  title,
  action,
  className,
  contentClassName,
  noPadding = false,
}: SectionFrameProps) {
  return (
    <div
      className={cn(
        "oc-surface overflow-hidden rounded-lg",
        className
      )}
    >
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-[rgba(142,152,169,0.12)] px-4 py-3">
          {title && (
            <div className="text-sm font-medium text-[#F2F5FA]">{title}</div>
          )}
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={cn(!noPadding && "p-4", contentClassName)}>{children}</div>
    </div>
  );
}
