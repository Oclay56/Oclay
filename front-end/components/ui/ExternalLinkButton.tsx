"use client";

import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { openExternalLink } from "@/lib/utils/links";

interface ExternalLinkButtonProps {
  href: string;
  className?: string;
  size?: "sm" | "md";
  label?: string;
}

export function ExternalLinkButton({
  href,
  className,
  size = "sm",
  label,
}: ExternalLinkButtonProps) {
  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
  };

  return (
    <button
      onClick={() => openExternalLink(href)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded p-1",
        "text-[#8B93A7] hover:text-[#2EC3E5] hover:bg-[#1E222C]",
        "transition-colors duration-150",
        className
      )}
      title="Open in external explorer"
    >
      <ExternalLink className={iconSizes[size]} />
      {label && <span className="text-xs">{label}</span>}
    </button>
  );
}
