"use client";

import { cn } from "@/lib/utils";

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export function LoadingState({
  message = "Loading...",
  className,
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-4",
        "text-center",
        className
      )}
    >
      <div className="mb-4 flex items-center gap-1">
        <div className="h-2 w-2 animate-bounce rounded-full bg-[#2EC3E5] [animation-delay:-0.3s]" />
        <div className="h-2 w-2 animate-bounce rounded-full bg-[#2EC3E5] [animation-delay:-0.15s]" />
        <div className="h-2 w-2 animate-bounce rounded-full bg-[#2EC3E5]" />
      </div>
      <p className="text-xs text-[#8B93A7]">{message}</p>
    </div>
  );
}
