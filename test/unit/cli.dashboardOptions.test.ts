import { describe, expect, test } from "vitest";
import { resolveDashboardCliOptions } from "../../src/dashboard/options";

describe("cli dashboard options", () => {
  test("uses defaults when values are not provided", () => {
    const resolved = resolveDashboardCliOptions(
      {},
      {
        dashboard: true,
        refreshSec: 2,
        rows: 8,
        hideSuccess: false,
        onlyFailures: false,
        alertsWindowMin: 15,
        rollupWindowMin: 60
      }
    );
    expect(resolved).toEqual({
      dashboard: true,
      refreshSec: 2,
      rows: 8,
      hideSuccess: false,
      onlyFailures: false,
      focusMint: undefined,
      alertsWindowMin: 15,
      rollupWindowMin: 60
    });
  });

  test("accepts explicit overrides", () => {
    const resolved = resolveDashboardCliOptions(
      {
        dashboard: false,
        refreshSec: 5,
        rows: 15,
        hideSuccess: true,
        focusMint: "  MintA  ",
        alertsWindowMin: 9,
        rollupWindowMin: 120
      },
      {
        dashboard: true,
        refreshSec: 2,
        rows: 8,
        hideSuccess: false,
        onlyFailures: false,
        alertsWindowMin: 15,
        rollupWindowMin: 60
      }
    );
    expect(resolved).toEqual({
      dashboard: false,
      refreshSec: 5,
      rows: 15,
      hideSuccess: true,
      onlyFailures: false,
      focusMint: "MintA",
      alertsWindowMin: 9,
      rollupWindowMin: 120
    });
  });

  test("falls back on invalid numeric values", () => {
    const resolved = resolveDashboardCliOptions(
      { refreshSec: 0, rows: -3, alertsWindowMin: 0, rollupWindowMin: -1 },
      {
        dashboard: false,
        refreshSec: 2,
        rows: 8,
        hideSuccess: false,
        onlyFailures: false,
        alertsWindowMin: 15,
        rollupWindowMin: 60
      }
    );
    expect(resolved).toEqual({
      dashboard: false,
      refreshSec: 2,
      rows: 8,
      hideSuccess: false,
      onlyFailures: false,
      focusMint: undefined,
      alertsWindowMin: 15,
      rollupWindowMin: 60
    });
  });

  test("only-failures overrides hide-success", () => {
    const resolved = resolveDashboardCliOptions(
      { hideSuccess: false, onlyFailures: true },
      {
        dashboard: true,
        refreshSec: 2,
        rows: 8,
        hideSuccess: false,
        onlyFailures: false,
        alertsWindowMin: 15,
        rollupWindowMin: 60
      }
    );
    expect(resolved.onlyFailures).toBe(true);
    expect(resolved.hideSuccess).toBe(true);
  });
});
