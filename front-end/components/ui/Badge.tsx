"use client";

import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info" | "neutral";
  size?: "sm" | "md";
  className?: string;
}

export function Badge({
  children,
  variant = "default",
  size = "sm",
  className,
}: BadgeProps) {
  const variants = {
    default: "bg-[#2EC3E5]/15 text-[#2EC3E5]",
    success: "bg-[#27C587]/15 text-[#27C587]",
    warning: "bg-[#F6B046]/15 text-[#F6B046]",
    danger: "bg-[#F24E4E]/15 text-[#F24E4E]",
    info: "bg-[#2EC3E5]/15 text-[#2EC3E5]",
    neutral: "bg-[#8B93A7]/15 text-[#8B93A7]",
  };

  const sizes = {
    sm: "px-1.5 py-0.5 text-[10px] font-medium",
    md: "px-2 py-1 text-xs font-medium",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded font-mono uppercase tracking-wide",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </span>
  );
}
