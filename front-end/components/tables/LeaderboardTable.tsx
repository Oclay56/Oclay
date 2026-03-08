"use client";

import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { LeaderboardEntry } from "@/lib/types";
import { formatNumber, formatUsd, formatPercent, getPnlColor } from "@/lib/utils";
import { useUIStore } from "@/lib/state";
import { ArrowUpDown, ArrowUp, ArrowDown, Trophy } from "lucide-react";

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  className?: string;
}

const columnHelper = createColumnHelper<LeaderboardEntry>();

export function LeaderboardTable({ entries, className }: LeaderboardTableProps) {
  const { tableCompact } = useUIStore();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "totalPnlUsd", desc: true },
  ]);

  const columns = [
    columnHelper.display({
      id: "rank",
      header: "#",
      cell: (info) => {
        const rank = info.row.index + 1;
        return (
          <div className="flex items-center gap-1">
            {rank <= 3 && (
              <Trophy className={cn(
                "h-3.5 w-3.5",
                rank === 1 ? "text-[#F6B046]" :
                rank === 2 ? "text-[#A7AFBF]" :
                "text-[#CD7F32]"
              )} />
            )}
            <span className={cn(
              "text-xs font-medium",
              rank === 1 ? "text-[#F6B046]" :
              rank === 2 ? "text-[#A7AFBF]" :
              rank === 3 ? "text-[#CD7F32]" :
              "text-[#8B93A7]"
            )}>
              {rank}
            </span>
          </div>
        );
      },
    }),
    columnHelper.accessor("key", {
      header: "Strategy",
      cell: (info) => (
        <span className="text-sm font-medium text-[#F2F5FA]">
          {info.getValue().replace(/_/g, " ").toUpperCase()}
        </span>
      ),
    }),
    columnHelper.accessor("trades", {
      header: "Trades",
      cell: (info) => (
        <span className="font-mono text-xs text-[#A7AFBF]">
          {formatNumber(info.getValue(), { decimals: 0 })}
        </span>
      ),
    }),
    columnHelper.accessor("winRate", {
      header: "Win Rate",
      cell: (info) => {
        const winRate = info.getValue();
        return (
          <span className={cn(
            "font-mono text-xs",
            winRate >= 0.6 ? "text-[#27C587]" :
            winRate >= 0.5 ? "text-[#F6B046]" :
            "text-[#F24E4E]"
          )}>
            {formatPercent(winRate)}
          </span>
        );
      },
    }),
    columnHelper.accessor("avgPnlUsd", {
      header: "Avg PnL",
      cell: (info) => (
        <span className={cn("font-mono text-xs", getPnlColor(info.getValue()))}>
          {formatUsd(info.getValue(), { showSign: true })}
        </span>
      ),
    }),
    columnHelper.accessor("totalPnlUsd", {
      header: "Total PnL",
      cell: (info) => (
        <span className={cn("font-mono text-xs font-medium", getPnlColor(info.getValue()))}>
          {formatUsd(info.getValue(), { showSign: true })}
        </span>
      ),
    }),
  ];

  const table = useReactTable({
    data: entries,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-[rgba(142,152,169,0.12)]">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={cn(
                    "px-3 text-left font-medium text-[#8B93A7] uppercase tracking-wide",
                    tableCompact ? "py-1.5 text-[11px]" : "py-2 text-xs"
                  )}
                >
                  {header.isPlaceholder ? null : (
                    <button
                      className={cn(
                        "flex items-center gap-1 hover:text-[#F2F5FA] transition-colors",
                        header.column.getCanSort() && "cursor-pointer"
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <span className="text-[10px]">
                          {header.column.getIsSorted() === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : header.column.getIsSorted() === "desc" ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-50" />
                          )}
                        </span>
                      )}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-[rgba(142,152,169,0.08)] hover:bg-[#171A21]/50 transition-colors"
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn("px-3", tableCompact ? "py-1.5" : "py-2.5")}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
