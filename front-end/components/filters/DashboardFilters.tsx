"use client";

import { cn } from "@/lib/utils";
import { useFiltersStore } from "@/lib/state";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SlidersHorizontal } from "lucide-react";

interface DashboardFiltersProps {
  className?: string;
}

export function DashboardFilters({ className }: DashboardFiltersProps) {
  const { dashboard, setDashboardFilters } = useFiltersStore();

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2 mb-4">
        <SlidersHorizontal className="h-4 w-4 text-[#8B93A7]" />
        <span className="text-sm font-medium text-[#F2F5FA]">Dashboard Filters</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Refresh interval */}
        <div className="space-y-2">
          <Label className="text-xs text-[#8B93A7]">Refresh Interval (seconds)</Label>
          <Select
            value={String(dashboard.refreshSec)}
            onValueChange={(v) => setDashboardFilters({ refreshSec: Number(v) })}
          >
            <SelectTrigger className="text-[#F2F5FA]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1s</SelectItem>
              <SelectItem value="2">2s</SelectItem>
              <SelectItem value="5">5s</SelectItem>
              <SelectItem value="10">10s</SelectItem>
              <SelectItem value="30">30s</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Rows to show */}
        <div className="space-y-2">
          <Label className="text-xs text-[#8B93A7]">Rows</Label>
          <Select
            value={String(dashboard.rows)}
            onValueChange={(v) => setDashboardFilters({ rows: Number(v) })}
          >
            <SelectTrigger className="text-[#F2F5FA]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5</SelectItem>
              <SelectItem value="8">8</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Focus mint */}
        <div className="space-y-2">
          <Label className="text-xs text-[#8B93A7]">Focus Mint</Label>
          <Input
            value={dashboard.focusMint}
            onChange={(e) => setDashboardFilters({ focusMint: e.target.value })}
            placeholder="Enter mint address..."
            className="text-[#F2F5FA] placeholder:text-[#8B93A7]"
          />
        </div>

        {/* Alerts window */}
        <div className="space-y-2">
          <Label className="text-xs text-[#8B93A7]">Alerts Window (minutes)</Label>
          <Select
            value={String(dashboard.alertsWindowMin)}
            onValueChange={(v) => setDashboardFilters({ alertsWindowMin: Number(v) })}
          >
            <SelectTrigger className="text-[#F2F5FA]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5m</SelectItem>
              <SelectItem value="15">15m</SelectItem>
              <SelectItem value="30">30m</SelectItem>
              <SelectItem value="60">1h</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Rollup window */}
        <div className="space-y-2">
          <Label className="text-xs text-[#8B93A7]">Rollup Window (minutes)</Label>
          <Select
            value={String(dashboard.rollupWindowMin)}
            onValueChange={(v) => setDashboardFilters({ rollupWindowMin: Number(v) })}
          >
            <SelectTrigger className="text-[#F2F5FA]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15m</SelectItem>
              <SelectItem value="30">30m</SelectItem>
              <SelectItem value="60">1h</SelectItem>
              <SelectItem value="240">4h</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Toggles */}
      <div className="flex flex-wrap gap-6 pt-2">
        <div className="flex items-center gap-2">
          <Switch
            checked={dashboard.hideSuccess}
            onCheckedChange={(v) => setDashboardFilters({ hideSuccess: v })}
          />
          <Label className="text-xs text-[#A7AFBF]">Hide Success</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={dashboard.onlyFailures}
            onCheckedChange={(v) => setDashboardFilters({ onlyFailures: v })}
          />
          <Label className="text-xs text-[#A7AFBF]">Only Failures</Label>
        </div>
      </div>
    </div>
  );
}
