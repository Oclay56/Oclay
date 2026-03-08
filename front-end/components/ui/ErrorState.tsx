"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Error loading data",
  description = "Something went wrong while fetching the data.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-4",
        "text-center",
        className
      )}
    >
      <div className="mb-4 rounded-full bg-[#F24E4E]/15 p-3">
        <AlertTriangle className="h-6 w-6 text-[#F24E4E]" />
      </div>
      <h3 className="text-sm font-medium text-[#F2F5FA]">{title}</h3>
      <p className="mt-1 text-xs text-[#8B93A7]">{description}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className={cn(
            "mt-4 inline-flex items-center gap-2",
            "rounded-lg bg-[#1E222C] px-3 py-2",
            "text-xs font-medium text-[#F2F5FA]",
            "hover:bg-[#272B36] transition-colors"
          )}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}
