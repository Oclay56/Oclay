"use client";

import { cn } from "@/lib/utils";

interface KeyValueItem {
  key: string;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

interface KeyValueListProps {
  items: KeyValueItem[];
  className?: string;
  itemClassName?: string;
  columns?: 1 | 2 | 3;
}

export function KeyValueList({
  items,
  className,
  itemClassName,
  columns = 1,
}: KeyValueListProps) {
  const columnClasses = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
  };

  return (
    <div className={cn("grid gap-3", columnClasses[columns], className)}>
      {items.map((item) => (
        <div key={item.key} className={cn("space-y-1", itemClassName)}>
          <span className="text-[10px] uppercase tracking-wider text-[#8B93A7]">
            {item.label}
          </span>
          <div
            className={cn(
              "text-sm text-[#F2F5FA]",
              item.mono && "font-mono"
            )}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
