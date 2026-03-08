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
import { ActiveBlock } from "@/lib/types";
import { formatMint, formatCountdown } from "@/lib/utils";
import { useUIStore } from "@/lib/state";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExternalLinkButton } from "@/components/ui/ExternalLinkButton";
import { getSolscanTokenUrl } from "@/lib/utils/links";
import { ArrowUpDown, ArrowUp, ArrowDown, Clock } from "lucide-react";

interface BlocksTableProps {
  blocks: ActiveBlock[];
  className?: string;
}

const columnHelper = createColumnHelper<ActiveBlock>();

export function BlocksTable({ blocks, className }: BlocksTableProps) {
  const { tableCompact } = useUIStore();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "expiresAtMs", desc: false },
  ]);

  const columns = [
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
          </div>
        );
      },
    }),
    columnHelper.accessor("reason", {
      header: "Reason",
      cell: (info) => {
        const reason = info.getValue();
        const isCritical = ["EXIT_ROUTE_GONE", "LIQUIDITY_DRAIN", "SUPPLY_INCREASED", "PROBE_FAILED"].includes(reason);
        return (
          <span className={cn(
            "inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase",
            isCritical
              ? "bg-[#F24E4E]/15 text-[#F24E4E]"
              : "bg-[#F6B046]/15 text-[#F6B046]"
          )}>
            {reason}
          </span>
        );
      },
    }),
    columnHelper.accessor("expiresAtMs", {
      header: "Expires In",
      cell: (info) => {
        const expiresAt = info.getValue();
        const isExpired = expiresAt <= Date.now();
        return (
          <div className={cn(
            "flex items-center gap-1.5 text-xs",
            isExpired ? "text-[#8B93A7]" : "text-[#F6B046]"
          )}>
            <Clock className="h-3 w-3" />
            {isExpired ? "Expired" : formatCountdown(expiresAt)}
          </div>
        );
      },
    }),
  ];

  const table = useReactTable({
    data: blocks,
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
