import "dotenv/config";
import { Command } from "commander";
import { loadAppConfig, loadRuntimeEnv } from "./config/loadConfig";
import { createLogger } from "./utils/log";
import { runBot, analyzeOnce } from "./runtime/main";
import { openSqlite } from "./storage/sqlite";
import { runMigrations } from "./storage/migrations";
import { createRepos } from "./storage/repos";
import { runDashboardPipeline } from "./dashboard/pipeline";
import { resolveDashboardCliOptions } from "./dashboard/options";
import { readDashboardSnapshot } from "./dashboard/readModel";
import { runWebServer } from "./web/server";

async function main() {
  const program = new Command();
  program.name("oclay").description("Autonomous Solana memecoin trading bot (safe-by-default).");

  program
    .command("run")
    .description("Run bot (live only if LIVE_TRADING flags are enabled; otherwise paper).")
    .option("--config <path>", "Path to strategy config JSON (overrides CONFIG_PATH env).")
    .option("--durationSec <seconds>", "Stop after N seconds (useful for testing).", (v) => Number.parseInt(v, 10))
    .option("--dashboard", "Enable live dashboard while running.")
    .option("--refreshSec <seconds>", "Dashboard refresh interval in seconds (default 2).", (v) => Number.parseInt(v, 10))
    .option("--rows <n>", "Rows per dashboard section (default 8).", (v) => Number.parseInt(v, 10))
    .option("--hide-success", "Hide successful execution rows from dashboard.")
    .option("--only-failures", "Show only failed execution rows (overrides --hide-success).")
    .option("--focusMint <mint>", "Focus dashboard coin panel on a specific mint.")
    .option("--alertsWindowMin <minutes>", "Alerts lookback window in minutes (default 15).", (v) => Number.parseInt(v, 10))
    .option("--rollupWindowMin <minutes>", "Mint rollup lookback window in minutes (default 60).", (v) => Number.parseInt(v, 10))
    .action(
      async (opts: {
        config?: string;
        durationSec?: number;
        dashboard?: boolean;
        refreshSec?: number;
        rows?: number;
        hideSuccess?: boolean;
        onlyFailures?: boolean;
        focusMint?: string;
        alertsWindowMin?: number;
        rollupWindowMin?: number;
      }) => {
      const env = loadRuntimeEnv();
      const cfg = loadAppConfig(opts.config ?? env.configPath);
      const stopAfterMs = opts.durationSec && opts.durationSec > 0 ? opts.durationSec * 1000 : undefined;
      const dashboardOpts = resolveDashboardCliOptions(opts, {
        dashboard: false,
        refreshSec: 2,
        rows: 8,
        hideSuccess: false,
        onlyFailures: false,
        alertsWindowMin: 15,
        rollupWindowMin: 60
      });

      if (dashboardOpts.dashboard) {
        const logger = createLogger(env.dashboardLogLevel, {
          target: env.dashboardLogTarget,
          path: env.dashboardLogPath
        });
        await runDashboardPipeline({
          cfg,
          env,
          logger,
          stopAfterMs,
          refreshSec: dashboardOpts.refreshSec,
          rows: dashboardOpts.rows,
          hideSuccess: dashboardOpts.hideSuccess,
          onlyFailures: dashboardOpts.onlyFailures,
          focusMint: dashboardOpts.focusMint,
          alertsWindowMin: dashboardOpts.alertsWindowMin,
          rollupWindowMin: dashboardOpts.rollupWindowMin
        });
        return;
      }

      const logger = createLogger(env.logLevel);
      await runBot({ cfg, env, logger, stopAfterMs });
    }
    );

  program
    .command("paper")
    .description("Run bot in paper mode (never sends transactions).")
    .option("--config <path>", "Path to strategy config JSON (overrides CONFIG_PATH env).")
    .option("--durationSec <seconds>", "Stop after N seconds (useful for testing).", (v) => Number.parseInt(v, 10))
    .option("--dashboard", "Enable live dashboard while running.", true)
    .option("--no-dashboard", "Disable dashboard and use structured log stream.")
    .option("--refreshSec <seconds>", "Dashboard refresh interval in seconds (default 2).", (v) => Number.parseInt(v, 10))
    .option("--rows <n>", "Rows per dashboard section (default 8).", (v) => Number.parseInt(v, 10))
    .option("--hide-success", "Hide successful execution rows from dashboard.")
    .option("--only-failures", "Show only failed execution rows (overrides --hide-success).")
    .option("--focusMint <mint>", "Focus dashboard coin panel on a specific mint.")
    .option("--alertsWindowMin <minutes>", "Alerts lookback window in minutes (default 15).", (v) => Number.parseInt(v, 10))
    .option("--rollupWindowMin <minutes>", "Mint rollup lookback window in minutes (default 60).", (v) => Number.parseInt(v, 10))
    .action(
      async (opts: {
        config?: string;
        durationSec?: number;
        dashboard?: boolean;
        refreshSec?: number;
        rows?: number;
        hideSuccess?: boolean;
        onlyFailures?: boolean;
        focusMint?: string;
        alertsWindowMin?: number;
        rollupWindowMin?: number;
      }) => {
      const env = loadRuntimeEnv();
      const cfg = loadAppConfig(opts.config ?? env.configPath);
      const stopAfterMs = opts.durationSec && opts.durationSec > 0 ? opts.durationSec * 1000 : undefined;
      const dashboardOpts = resolveDashboardCliOptions(opts, {
        dashboard: true,
        refreshSec: 2,
        rows: 8,
        hideSuccess: false,
        onlyFailures: false,
        alertsWindowMin: 15,
        rollupWindowMin: 60
      });

      if (dashboardOpts.dashboard) {
        const logger = createLogger(env.dashboardLogLevel, {
          target: env.dashboardLogTarget,
          path: env.dashboardLogPath
        });
        await runDashboardPipeline({
          cfg,
          env,
          logger,
          forcePaper: true,
          stopAfterMs,
          refreshSec: dashboardOpts.refreshSec,
          rows: dashboardOpts.rows,
          hideSuccess: dashboardOpts.hideSuccess,
          onlyFailures: dashboardOpts.onlyFailures,
          focusMint: dashboardOpts.focusMint,
          alertsWindowMin: dashboardOpts.alertsWindowMin,
          rollupWindowMin: dashboardOpts.rollupWindowMin
        });
        return;
      }

      const logger = createLogger(env.logLevel);
      await runBot({ cfg, env, logger, forcePaper: true, stopAfterMs });
    }
    );

  program
    .command("web")
    .description("Run the local web console API, optionally with an attached paper/live bot workflow.")
    .option("--config <path>", "Path to strategy config JSON (overrides CONFIG_PATH env).")
    .option("--host <host>", "Bind host (default 127.0.0.1).")
    .option("--port <port>", "Bind port (default 3100).", (v) => Number.parseInt(v, 10))
    .option("--mode <mode>", "Workflow mode: observe, paper, or live.", "observe")
    .option("--durationSec <seconds>", "Stop attached bot workflow after N seconds.", (v) => Number.parseInt(v, 10))
    .action(
      async (opts: {
        config?: string;
        host?: string;
        port?: number;
        mode?: string;
        durationSec?: number;
      }) => {
        const env = loadRuntimeEnv();
        const cfg = loadAppConfig(opts.config ?? env.configPath);
        const logger = createLogger(env.logLevel);
        const stopAfterMs = opts.durationSec && opts.durationSec > 0 ? opts.durationSec * 1000 : undefined;
        const workflowMode =
          opts.mode === "paper" || opts.mode === "live" ? opts.mode : "observe";

        await runWebServer({
          cfg,
          env,
          logger,
          host: opts.host,
          port: opts.port,
          workflowMode,
          stopAfterMs,
          initialConfigPath: opts.config ?? env.configPath
        });
      }
    );

  program
    .command("analyze")
    .description("Analyze a single mint and print the full risk report as JSON.")
    .option("--config <path>", "Path to strategy config JSON (overrides CONFIG_PATH env).")
    .requiredOption("--mint <pubkey>", "Token mint address")
    .action(async (opts: { config?: string; mint: string }) => {
      const env = loadRuntimeEnv();
      const cfg = loadAppConfig(opts.config ?? env.configPath);
      // Keep stdout clean JSON for scripting.
      const logger = createLogger("silent");
      const res = await analyzeOnce({ cfg, env, logger, mint: opts.mint });
      // eslint-disable-next-line no-console
      console.log(res.reportJson);
    });

  program
    .command("positions")
    .description("List positions from the local SQLite DB.")
    .action(async () => {
      const env = loadRuntimeEnv();
      const db = openSqlite(env.dbPath);
      runMigrations(db);
      const rows = db
        .prepare(
          "SELECT id, mint, mode, status, opened_at, closed_at, entry_base_amount, exit_base_amount, pnl_usd FROM positions ORDER BY opened_at DESC LIMIT 50;"
        )
        .all();
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(rows, null, 2));
      db.close();
    });

  program
    .command("blocklist")
    .description("List blocked mints and expiry.")
    .action(async () => {
      const env = loadRuntimeEnv();
      const db = openSqlite(env.dbPath);
      runMigrations(db);
      const rows = db
        .prepare("SELECT mint, reason, blocked_at, expires_at FROM blocks ORDER BY expires_at DESC LIMIT 200;")
        .all();
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(rows, null, 2));
      db.close();
    });

  program
    .command("stats")
    .description("Show high-level DB ingestion and position/execution counts.")
    .action(async () => {
      const env = loadRuntimeEnv();
      const db = openSqlite(env.dbPath);
      runMigrations(db);
      const nowMs = Date.now();
      const mode = env.liveTradingEnabled ? "live" : "paper";
      const snapshot = readDashboardSnapshot(db, {
        mode,
        startedAtMs: nowMs,
        nowMs,
        refreshSec: 2,
        dbPath: env.dbPath,
        rows: 1,
        latencyWindowMinutes: 60,
        leaderboardLimit: 1
      });
      const counts = snapshot.counts;
      const latest = snapshot.recentReports[0];
      const lastReport = latest
        ? {
            mint: latest.mint,
            created_at: latest.createdAtMs,
            risk_score: latest.riskScore,
            trade_score: latest.tradeScore,
            flags_json: JSON.stringify(latest.flags)
          }
        : null;
      const lastToken = db.prepare("SELECT mint, last_seen_at FROM tokens ORDER BY last_seen_at DESC LIMIT 1;").get();

      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ counts, lastReport, lastToken }, null, 2));
      db.close();
    });

  program
    .command("latency")
    .description("Show lifecycle latency stats derived from trade lifecycle events.")
    .option("--config <path>", "Path to strategy config JSON (overrides CONFIG_PATH env).")
    .option("--windowMin <minutes>", "Window in minutes (default 60).", (v) => Number.parseInt(v, 10))
    .option("--mode <mode>", "Latency key model (default from config).")
    .action(async (opts: { config?: string; windowMin?: number; mode?: string }) => {
      const env = loadRuntimeEnv();
      const cfg = loadAppConfig(opts.config ?? env.configPath);
      const db = openSqlite(env.dbPath);
      runMigrations(db);
      const repos = createRepos(db);
      const windowMin = opts.windowMin && opts.windowMin > 0 ? opts.windowMin : 60;
      const mode =
        opts.mode === "candidate_intent_position" ? opts.mode : cfg.telemetry.latencyKeyModel;
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(repos.getLatencyStats(windowMin, mode), null, 2));
      db.close();
    });

  program
    .command("leaderboard")
    .description("Show attribution leaderboard from closed trades.")
    .option("--limit <n>", "Row limit (default 10).", (v) => Number.parseInt(v, 10))
    .action(async (opts: { limit?: number }) => {
      const env = loadRuntimeEnv();
      const db = openSqlite(env.dbPath);
      runMigrations(db);
      const repos = createRepos(db);
      const limit = opts.limit && opts.limit > 0 ? opts.limit : 10;
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(repos.getAttributionLeaderboard(limit), null, 2));
      db.close();
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
