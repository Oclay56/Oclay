"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X, LayoutList, LayoutGrid } from "lucide-react";
import { useUIStore } from "@/lib/state";

interface TableToolbarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  extraFilters?: React.ReactNode;
  className?: string;
}

export function TableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  extraFilters,
  className,
}: TableToolbarProps) {
  const { tableCompact, toggleTableDensity } = useUIStore();

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8B93A7]" />
        <Input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="pl-9 text-[#F2F5FA] placeholder:text-[#8B93A7]"
        />
        {searchValue && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8B93A7] hover:text-[#F2F5FA]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Extra filters */}
      {extraFilters && <div className="flex items-center gap-2">{extraFilters}</div>}

      {/* Density toggle */}
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleTableDensity}
        className="oc-surface-soft text-[#8B93A7] hover:text-[#F2F5FA] hover:bg-[rgba(30,34,44,0.28)]"
      >
        {tableCompact ? <LayoutGrid className="h-4 w-4" /> : <LayoutList className="h-4 w-4" />}
      </Button>
    </div>
  );
}
