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
import { Execution } from "@/lib/types";
import { formatRelativeTime, formatMint, formatTokenAmount } from "@/lib/utils";
import { useUIStore } from "@/lib/state";
import { getSideBadge, getExecutionResultBadge, getRouterBadge } from "@/lib/utils/badges";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExternalLinkButton } from "@/components/ui/ExternalLinkButton";
import { getSolscanTokenUrl } from "@/lib/utils/links";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface ExecutionsTableProps {
  executions: Execution[];
  className?: string;
}

const columnHelper = createColumnHelper<Execution>();

export function ExecutionsTable({ executions, className }: ExecutionsTableProps) {
  const { tableCompact } = useUIStore();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "requestedAtMs", desc: true },
  ]);

  const columns = [
    columnHelper.accessor("requestedAtMs", {
      header: "Time",
      cell: (info) => (
        <span className="text-xs text-[#A7AFBF]">
          {formatRelativeTime(info.getValue())}
        </span>
      ),
    }),
    columnHelper.accessor("side", {
      header: "Side",
      cell: (info) => {
        const badge = getSideBadge(info.getValue());
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
    columnHelper.accessor("ok", {
      header: "Result",
      cell: (info) => {
        const ok = info.getValue();
        const err = info.row.original.err;
        const badge = getExecutionResultBadge(ok, err);
        return (
          <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", badge.bg, badge.text)}>
            {badge.label}
          </span>
        );
      },
    }),
    columnHelper.accessor("routerPath", {
      header: "Router",
      cell: (info) => {
        const router = info.getValue();
        if (!router) return <span className="text-xs text-[#8B93A7]">â€”</span>;
        const badge = getRouterBadge(router);
        return (
          <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium", badge.bg, badge.text)}>
            {badge.label}
          </span>
        );
      },
    }),
    columnHelper.accessor("inAmount", {
      header: "In",
      cell: (info) => (
        <span className="font-mono text-xs text-[#A7AFBF]">
          {formatTokenAmount(info.getValue(), 4)}
        </span>
      ),
    }),
    columnHelper.accessor("outAmount", {
      header: "Out",
      cell: (info) => (
        <span className="font-mono text-xs text-[#A7AFBF]">
          {formatTokenAmount(info.getValue(), 4)}
        </span>
      ),
    }),
    columnHelper.accessor("err", {
      header: "Error",
      cell: (info) => {
        const err = info.getValue();
        if (!err) return <span className="text-xs text-[#8B93A7]">â€”</span>;
        return (
          <span className="text-xs text-[#F24E4E] truncate max-w-[150px]" title={err}>
            {err}
          </span>
        );
      },
    }),
  ];

  const table = useReactTable({
    data: executions,
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
