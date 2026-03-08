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
import { OpenPosition, Position } from "@/lib/types";
import { formatRelativeTime, formatMint, formatPrice, formatTokenAmount } from "@/lib/utils";
import { useUIStore } from "@/lib/state";
import { getPositionStatusBadge, getWorkflowPhaseBadge } from "@/lib/utils/badges";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExternalLinkButton } from "@/components/ui/ExternalLinkButton";
import { getSolscanTokenUrl } from "@/lib/utils/links";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface PositionsTableProps {
  positions: Array<OpenPosition | Position>;
  onRowClick?: (position: OpenPosition | Position) => void;
  className?: string;
}

type PositionRow = OpenPosition | Position;

const columnHelper = createColumnHelper<PositionRow>();

export function PositionsTable({ positions, onRowClick, className }: PositionsTableProps) {
  const { tableCompact } = useUIStore();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "openedAtMs", desc: true },
  ]);

  const columns = [
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => {
        const badge = getPositionStatusBadge(info.getValue());
        return (
          <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", badge.bg, badge.text)}>
            {badge.label}
          </span>
        );
      },
    }),
    columnHelper.accessor((row) => row.workflowPhase, {
      id: "workflowPhase",
      header: "Phase",
      cell: (info) => {
        const badge = getWorkflowPhaseBadge(info.getValue());
        return (
          <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", badge.bg, badge.text)}>
            {badge.label}
          </span>
        );
      },
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
          </div>
        );
      },
    }),
    columnHelper.accessor("openedAtMs", {
      header: "Opened",
      cell: (info) => (
        <span className="text-xs text-[#A7AFBF]">
          {formatRelativeTime(info.getValue())}
        </span>
      ),
    }),
    columnHelper.accessor("entryPriceUsd", {
      header: "Entry Price",
      cell: (info) => (
        <span className="font-mono text-xs text-[#F2F5FA]">
          {formatPrice(info.getValue())}
        </span>
      ),
    }),
    columnHelper.accessor("maxSeenPriceUsd", {
      header: "Max Seen",
      cell: (info) => {
        const value = info.getValue();
        const entryPrice = info.row.original.entryPriceUsd;
        const isHigher = value && entryPrice && value > entryPrice;
        return (
          <span className={cn(
            "font-mono text-xs",
            isHigher ? "text-[#27C587]" : "text-[#F2F5FA]"
          )}>
            {formatPrice(value)}
          </span>
        );
      },
    }),
    columnHelper.accessor("entryTokenAmount", {
      header: "Amount",
      cell: (info) => (
        <span className="font-mono text-xs text-[#A7AFBF]">
          {formatTokenAmount(info.getValue(), 2)}
        </span>
      ),
    }),
  ];

  const table = useReactTable({
    data: positions,
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
              onClick={() => onRowClick?.(row.original)}
              className={cn(
                "border-b border-[rgba(142,152,169,0.08)] hover:bg-[#171A21]/50 transition-colors",
                onRowClick && "cursor-pointer"
              )}
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
