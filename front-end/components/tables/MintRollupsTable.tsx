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
import { MintRollup } from "@/lib/types";
import { formatRelativeTime, formatMint } from "@/lib/utils";
import { useUIStore } from "@/lib/state";
import { getPositionStatusBadge, getSideBadge } from "@/lib/utils/badges";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExternalLinkButton } from "@/components/ui/ExternalLinkButton";
import { getSolscanTokenUrl } from "@/lib/utils/links";
import { ArrowUpDown, ArrowUp, ArrowDown, Check, X } from "lucide-react";

interface MintRollupsTableProps {
  rollups: MintRollup[];
  className?: string;
}

const columnHelper = createColumnHelper<MintRollup>();

export function MintRollupsTable({ rollups, className }: MintRollupsTableProps) {
  const { tableCompact } = useUIStore();
  const [sorting, setSorting] = useState<SortingState>([]);

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
    columnHelper.accessor("hasActivePosition", {
      header: "Position",
      cell: (info) => {
        const hasPosition = info.getValue();
        const status = info.row.original.activePositionStatus;
        if (!hasPosition) return <span className="text-xs text-[#8B93A7]">â€”</span>;
        const badge = getPositionStatusBadge(status || "OPEN");
        return (
          <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", badge.bg, badge.text)}>
            {badge.label}
          </span>
        );
      },
    }),
    columnHelper.accessor("lastActionSide", {
      header: "Last Action",
      cell: (info) => {
        const side = info.getValue();
        if (!side) return <span className="text-xs text-[#8B93A7]">â€”</span>;
        const badge = getSideBadge(side);
        return (
          <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", badge.bg, badge.text)}>
            {badge.label}
          </span>
        );
      },
    }),
    columnHelper.accessor("lastActionAtMs", {
      header: "Last Action",
      cell: (info) => {
        const time = info.getValue();
        if (!time) return <span className="text-xs text-[#8B93A7]">â€”</span>;
        return (
          <span className="text-xs text-[#A7AFBF]">
            {formatRelativeTime(time)}
          </span>
        );
      },
    }),
    columnHelper.accessor("wins24h", {
      header: "Wins",
      cell: (info) => (
        <span className="text-xs text-[#27C587]">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor("losses24h", {
      header: "Losses",
      cell: (info) => (
        <span className="text-xs text-[#F24E4E]">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor("failedSells5m", {
      header: "Failed",
      cell: (info) => {
        const count = info.getValue();
        return (
          <span className={count > 0 ? "text-xs text-[#F6B046]" : "text-xs text-[#8B93A7]"}>
            {count}
          </span>
        );
      },
    }),
    columnHelper.accessor("routeOk", {
      header: "Route",
      cell: (info) => {
        const ok = info.getValue();
        return ok ? (
          <Check className="h-4 w-4 text-[#27C587]" />
        ) : (
          <X className="h-4 w-4 text-[#F24E4E]" />
        );
      },
    }),
  ];

  const table = useReactTable({
    data: rollups,
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
