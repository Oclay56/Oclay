export interface DashboardCliOptionInput {
  dashboard?: boolean;
  refreshSec?: number;
  rows?: number;
  hideSuccess?: boolean;
  onlyFailures?: boolean;
  focusMint?: string;
  alertsWindowMin?: number;
  rollupWindowMin?: number;
}

export interface DashboardCliOptionDefaults {
  dashboard: boolean;
  refreshSec: number;
  rows: number;
  hideSuccess: boolean;
  onlyFailures: boolean;
  alertsWindowMin: number;
  rollupWindowMin: number;
}

export interface ResolvedDashboardCliOptions {
  dashboard: boolean;
  refreshSec: number;
  rows: number;
  hideSuccess: boolean;
  onlyFailures: boolean;
  focusMint?: string;
  alertsWindowMin: number;
  rollupWindowMin: number;
}

export function resolveDashboardCliOptions(
  input: DashboardCliOptionInput,
  defaults: DashboardCliOptionDefaults
): ResolvedDashboardCliOptions {
  const onlyFailures = input.onlyFailures === undefined ? defaults.onlyFailures : Boolean(input.onlyFailures);
  const hideSuccess = onlyFailures
    ? true
    : input.hideSuccess === undefined
      ? defaults.hideSuccess
      : Boolean(input.hideSuccess);
  const focusMint = normalizeMint(input.focusMint);

  return {
    dashboard: input.dashboard === undefined ? defaults.dashboard : Boolean(input.dashboard),
    refreshSec: normalizePositiveInt(input.refreshSec, defaults.refreshSec),
    rows: normalizePositiveInt(input.rows, defaults.rows),
    hideSuccess,
    onlyFailures,
    focusMint,
    alertsWindowMin: normalizePositiveInt(input.alertsWindowMin, defaults.alertsWindowMin),
    rollupWindowMin: normalizePositiveInt(input.rollupWindowMin, defaults.rollupWindowMin)
  };
}

function normalizePositiveInt(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isFinite(v)) return fallback;
  const n = Math.floor(v);
  return n > 0 ? n : fallback;
}

function normalizeMint(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}
