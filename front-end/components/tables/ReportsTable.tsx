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
import { RiskReport } from "@/lib/types";
import { formatRelativeTime, formatMint, getScoreBg } from "@/lib/utils";
import { useUIStore } from "@/lib/state";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExternalLinkButton } from "@/components/ui/ExternalLinkButton";
import { getSolscanTokenUrl, getDexScreenerUrl } from "@/lib/utils/links";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface ReportsTableProps {
  reports: RiskReport[];
  className?: string;
}

const columnHelper = createColumnHelper<RiskReport>();

export function ReportsTable({ reports, className }: ReportsTableProps) {
  const { tableCompact } = useUIStore();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAtMs", desc: true },
  ]);

  const columns = [
    columnHelper.accessor("createdAtMs", {
      header: "Time",
      cell: (info) => (
        <span className="text-xs text-[#A7AFBF]">
          {formatRelativeTime(info.getValue())}
        </span>
      ),
    }),
    columnHelper.accessor("mint", {
      header: "Mint",
      cell: (info) => {
        const mint = info.getValue();
        return (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[#F2F5FA]">
              {formatMint(mint)}
            </span>
            <CopyButton text={mint} size="sm" />
            <ExternalLinkButton href={getSolscanTokenUrl(mint)} size="sm" />
            <ExternalLinkButton href={getDexScreenerUrl(mint)} size="sm" />
          </div>
        );
      },
    }),
    columnHelper.accessor("riskScore", {
      header: "Risk",
      cell: (info) => {
        const score = info.getValue();
        return (
          <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-medium", getScoreBg(score))}>
            {score}
          </span>
        );
      },
    }),
    columnHelper.accessor("tradeScore", {
      header: "Trade",
      cell: (info) => {
        const score = info.getValue();
        return (
          <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-medium", getScoreBg(score))}>
            {score}
          </span>
        );
      },
    }),
    columnHelper.accessor("flags", {
      header: "Flags",
      cell: (info) => {
        const flags = info.getValue();
        if (flags.length === 0) return <span className="text-xs text-[#8B93A7]">â€”</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {flags.slice(0, 2).map((flag) => (
              <span
                key={flag}
                className={cn(
                  "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium",
                  flag.includes("EXIT") || flag.includes("DRAIN")
                    ? "bg-[#F24E4E]/15 text-[#F24E4E]"
                    : "bg-[#F6B046]/15 text-[#F6B046]"
                )}
              >
                {flag}
              </span>
            ))}
            {flags.length > 2 && (
              <span className="text-[10px] text-[#8B93A7]">+{flags.length - 2}</span>
            )}
          </div>
        );
      },
    }),
  ];

  const table = useReactTable({
    data: reports,
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
