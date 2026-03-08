import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { RuntimeEnv } from "../config/loadConfig";
import { runBot } from "../runtime/main";
import { openSqlite } from "../storage/sqlite";
import { runMigrations } from "../storage/migrations";
import { sleepMs } from "../utils/time";
import { readDashboardSnapshot } from "./readModel";
import { renderCompactSummary, renderDashboard } from "./render";
import type { RuntimeDashboardState, RuntimeDashboardStatePatch } from "../runtime/dashboardState";

export interface DashboardTerminal {
  isTTY: boolean;
  columns?: number;
  write: (chunk: string) => void;
}

export interface RunDashboardPipelineParams {
  cfg: AppConfig;
  env: RuntimeEnv;
  logger: Logger;
  forcePaper?: boolean;
  stopAfterMs?: number;
  refreshSec: number;
  rows: number;
  hideSuccess?: boolean;
  onlyFailures?: boolean;
  focusMint?: string;
  alertsWindowMin?: number;
  rollupWindowMin?: number;
  terminal?: DashboardTerminal;
  runBotFn?: typeof runBot;
}

export async function runDashboardPipeline(params: RunDashboardPipelineParams): Promise<void> {
  const terminal: DashboardTerminal = params.terminal ?? {
    isTTY: Boolean(process.stdout.isTTY),
    columns: process.stdout.columns,
    write: (chunk: string) => process.stdout.write(chunk)
  };
  const runBotFn = params.runBotFn ?? runBot;

  const startedAtMs = Date.now();
  const mode: "paper" | "live" =
    params.forcePaper || !params.env.liveTradingEnabled ? "paper" : "live";
  const refreshSec = Math.max(1, Math.floor(params.refreshSec));
  const refreshMs = refreshSec * 1000;
  const rows = Math.max(1, Math.floor(params.rows));
  const hideSuccess = Boolean(params.onlyFailures) ? true : Boolean(params.hideSuccess);
  const onlyFailures = Boolean(params.onlyFailures);
  const alertsWindowMin = Math.max(1, Math.floor(params.alertsWindowMin ?? 15));
  const rollupWindowMin = Math.max(1, Math.floor(params.rollupWindowMin ?? 60));

  const db = openSqlite(params.env.dbPath);
  runMigrations(db);
  const runtimeState: RuntimeDashboardState = {};

  let botDone = false;
  let botErr: unknown;
  const botPromise = runBotFn({
    cfg: params.cfg,
    env: params.env,
    logger: params.logger,
    forcePaper: params.forcePaper,
    stopAfterMs: params.stopAfterMs,
    onRuntimeDashboardState: (patch: RuntimeDashboardStatePatch) => {
      mergeRuntimeDashboardState(runtimeState, patch);
    }
  })
    .catch((err) => {
      botErr = err;
    })
    .finally(() => {
      botDone = true;
    });

  let lastSnapshot = readDashboardSnapshot(db, {
    mode,
    startedAtMs,
    nowMs: Date.now(),
    refreshSec,
    dbPath: params.env.dbPath,
    rows,
    latencyWindowMinutes: params.cfg.telemetry.latencyWindowMinutes,
    leaderboardLimit: 3,
    hideSuccess,
    onlyFailures,
    focusMint: params.focusMint,
    alertsWindowMin,
    rollupWindowMin,
    runtimeState
  });
  let warning: string | undefined;

  try {
    while (!botDone) {
      const nowMs = Date.now();
      try {
        lastSnapshot = readDashboardSnapshot(db, {
          mode,
          startedAtMs,
          nowMs,
          refreshSec,
          dbPath: params.env.dbPath,
          rows,
          latencyWindowMinutes: params.cfg.telemetry.latencyWindowMinutes,
          leaderboardLimit: 3,
          hideSuccess,
          onlyFailures,
          focusMint: params.focusMint,
          alertsWindowMin,
          rollupWindowMin,
          runtimeState
        });
        warning = undefined;
      } catch (err) {
        warning = `dashboard read error: ${String(err)}`;
      }

      drawSnapshot(terminal, lastSnapshot, warning);
      await Promise.race([sleepMs(refreshMs), botPromise]);
    }

    // Final one-shot summary after bot exits.
    const finalNow = Date.now();
    try {
      lastSnapshot = readDashboardSnapshot(db, {
        mode,
        startedAtMs,
        nowMs: finalNow,
        refreshSec,
        dbPath: params.env.dbPath,
        rows,
        latencyWindowMinutes: params.cfg.telemetry.latencyWindowMinutes,
        leaderboardLimit: 3,
        hideSuccess,
        onlyFailures,
        focusMint: params.focusMint,
        alertsWindowMin,
        rollupWindowMin,
        runtimeState
      });
      warning = undefined;
    } catch (err) {
      warning = `dashboard read error: ${String(err)}`;
    }
    drawSnapshot(terminal, lastSnapshot, warning);
  } finally {
    db.close();
  }

  await botPromise;
  if (botErr) throw botErr;
}

function mergeRuntimeDashboardState(state: RuntimeDashboardState, patch: RuntimeDashboardStatePatch): void {
  if (patch.stream) {
    state.stream = {
      enabled: state.stream?.enabled ?? false,
      connected: state.stream?.connected ?? false,
      stale: state.stream?.stale ?? false,
      fallbackActive: state.stream?.fallbackActive ?? false,
      lastEventAtMs: state.stream?.lastEventAtMs,
      ...patch.stream
    };
  }
  if (patch.sell429) {
    state.sell429 = {
      globalCooldownUntilMs: state.sell429?.globalCooldownUntilMs,
      perMint: state.sell429?.perMint ?? [],
      ...patch.sell429
    };
  }
  if (patch.capital) {
    state.capital = {
      pendingReservedEntryUsd: state.capital?.pendingReservedEntryUsd ?? 0,
      baseAssetUsdPrice: state.capital?.baseAssetUsdPrice,
      baseAssetUsdPriceAtMs: state.capital?.baseAssetUsdPriceAtMs,
      walletSolBalance: state.capital?.walletSolBalance,
      walletUsdBalance: state.capital?.walletUsdBalance,
      walletBalanceAtMs: state.capital?.walletBalanceAtMs,
      realizedPnlUsd: state.capital?.realizedPnlUsd ?? 0,
      unrealizedPnlUsd: state.capital?.unrealizedPnlUsd ?? 0,
      deployedUsd: state.capital?.deployedUsd ?? 0,
      dailyDrawdownUsd: state.capital?.dailyDrawdownUsd ?? 0,
      ...patch.capital
    };
  }
}

function drawSnapshot(terminal: DashboardTerminal, snapshot: ReturnType<typeof readDashboardSnapshot>, warning?: string): void {
  if (terminal.isTTY) {
    terminal.write("\x1b[2J\x1b[H");
    const frame = renderDashboard(snapshot, {
      width: terminal.columns ?? 120,
      warning
    });
    terminal.write(`${frame}\n`);
    return;
  }
  terminal.write(`${renderCompactSummary(snapshot, warning)}\n`);
}
