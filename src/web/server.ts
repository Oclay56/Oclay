import fs from "node:fs";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import { loadAppConfig, type RuntimeEnv } from "../config/loadConfig";
import { analyzeOnce } from "../runtime/main";
import { runMigrations } from "../storage/migrations";
import { openSqlite, type SqliteDb } from "../storage/sqlite";
import {
  readBlocks,
  readDashboardResponse,
  readExecutions,
  readLatency,
  readLeaderboard,
  readMintDetail,
  readPositions,
  readRiskReports,
  readStrategyState,
  readSystemState
} from "./readApiModel";
import { RuntimeHub, type WebRuntimeEvent, type WebWorkflowMode } from "./runtimeHub";
import {
  BANKROLL_PRESETS_USD,
  RUN_PROFILES,
  recommendProfileForBankroll,
  resolveProfileByConfigPath,
  resolveProfileById
} from "./runProfiles";

export interface RunWebServerParams {
  cfg: AppConfig;
  env: RuntimeEnv;
  logger: Logger;
  host?: string;
  port?: number;
  workflowMode: WebWorkflowMode;
  stopAfterMs?: number;
  initialConfigPath?: string;
}

export async function runWebServer(params: RunWebServerParams): Promise<void> {
  if (params.workflowMode === "live" && !params.env.liveTradingEnabled) {
    throw new Error("web live mode requires LIVE_TRADING=true and LIVE_TRADING_CONFIRM to be set.");
  }

  const host = params.host?.trim() || "127.0.0.1";
  const port = Number.isFinite(params.port) && params.port && params.port > 0 ? Math.floor(params.port) : 3100;
  const db = openSqlite(params.env.dbPath);
  runMigrations(db);

  const runtimeHub = new RuntimeHub(
    params.workflowMode,
    params.cfg,
    params.env,
    params.logger,
    params.stopAfterMs,
    params.initialConfigPath
  );
  const startedAtMs = Date.now();
  const staticRoot = path.resolve(process.cwd(), "front-end", "dist");

  const server = createServer(async (req, res) => {
    try {
      await handleRequest({
        req,
        res,
        env: params.env,
        logger: params.logger,
        db,
        runtimeHub,
        startedAtMs,
        staticRoot
      });
    } catch (err) {
      params.logger.error({ err: String(err) }, "web request failed");
      writeJson(res, 500, { error: "internal_error", message: String(err) });
    }
  });

  const heartbeat = setInterval(() => {
    runtimeHub.emitHeartbeat();
  }, 5_000);
  heartbeat.unref?.();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  params.logger.info(
    { host, port, workflowMode: params.workflowMode, staticUi: fs.existsSync(staticRoot) },
    "web server listening"
  );

  await runtimeHub.start();
  runtimeHub.emitReady();

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      clearInterval(heartbeat);
      void runtimeHub
        .startWorkflow({
          workflowMode: "observe",
          cfg: runtimeHub.getConfig(),
          configPath: runtimeHub.getConfigPath()
        })
        .catch((err) => {
          params.logger.warn({ err: String(err) }, "runtime stop during shutdown failed");
        })
        .finally(() => {
          server.close(() => resolve());
        });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

  db.close();
}

async function handleRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  env: RuntimeEnv;
  logger: Logger;
  db: SqliteDb;
  runtimeHub: RuntimeHub;
  startedAtMs: number;
  staticRoot: string;
}): Promise<void> {
  const method = String(params.req.method || "GET").toUpperCase();
  const requestUrl = new URL(params.req.url || "/", "http://127.0.0.1");
  const pathname = requestUrl.pathname;

  if (method === "GET" && pathname === "/api/live/events") {
    handleSse(params.res, params.runtimeHub);
    return;
  }

  if (pathname === "/api/dashboard" && method === "GET") {
    const refreshSec = parseIntParam(requestUrl, "refreshSec", 2);
    const rows = parseIntParam(requestUrl, "rows", 8);
    const hideSuccess = parseBoolParam(requestUrl, "hideSuccess", false);
    const onlyFailures = parseBoolParam(requestUrl, "onlyFailures", false);
    const focusMint = requestUrl.searchParams.get("focusMint") ?? undefined;
    const alertsWindowMin = parseIntParam(requestUrl, "alertsWindowMin", 15);
    const rollupWindowMin = parseIntParam(requestUrl, "rollupWindowMin", 60);

    writeJson(
      params.res,
      200,
      readDashboardResponse({
        db: params.db,
        cfg: params.runtimeHub.getConfig(),
        env: params.env,
        runtimeState: params.runtimeHub.getRuntimeState(),
        runtimeStatus: params.runtimeHub.getStatusSnapshot(),
        startedAtMs: params.startedAtMs,
        refreshSec,
        rows,
        hideSuccess,
        onlyFailures,
        focusMint,
        alertsWindowMin,
        rollupWindowMin
      })
    );
    return;
  }

  if (pathname === "/api/positions" && method === "GET") {
    writeJson(
      params.res,
      200,
      readPositions(params.db, {
        status: requestUrl.searchParams.get("status") ?? undefined,
        mint: requestUrl.searchParams.get("mint") ?? undefined,
        limit: parseOptionalIntParam(requestUrl, "limit"),
        offset: parseOptionalIntParam(requestUrl, "offset")
      })
    );
    return;
  }

  if (pathname === "/api/executions" && method === "GET") {
    writeJson(
      params.res,
      200,
      readExecutions(params.db, {
        onlyFailures: parseBoolParam(requestUrl, "onlyFailures", false),
        hideSuccess: parseBoolParam(requestUrl, "hideSuccess", false),
        side: requestUrl.searchParams.get("side") ?? undefined,
        mint: requestUrl.searchParams.get("mint") ?? undefined,
        windowMin: parseOptionalIntParam(requestUrl, "windowMin")
      })
    );
    return;
  }

  if (pathname === "/api/risk" && method === "GET") {
    writeJson(
      params.res,
      200,
      readRiskReports(params.db, {
        latestPerMint: parseBoolParam(requestUrl, "latestPerMint", false),
        criticalOnly: parseBoolParam(requestUrl, "criticalOnly", false),
        mint: requestUrl.searchParams.get("mint") ?? undefined,
        limit: parseOptionalIntParam(requestUrl, "limit")
      })
    );
    return;
  }

  if (pathname === "/api/blocks" && method === "GET") {
    writeJson(
      params.res,
      200,
      readBlocks(params.db, {
        activeOnly: parseBoolParam(requestUrl, "activeOnly", true)
      })
    );
    return;
  }

  if (pathname === "/api/latency" && method === "GET") {
    writeJson(params.res, 200, readLatency(params.db, parseOptionalIntParam(requestUrl, "windowMin")));
    return;
  }

  if (pathname === "/api/leaderboard" && method === "GET") {
    writeJson(params.res, 200, readLeaderboard(params.db, parseOptionalIntParam(requestUrl, "limit")));
    return;
  }

  if (pathname === "/api/system" && method === "GET") {
    writeJson(
      params.res,
      200,
      readSystemState({
        env: params.env,
        runtimeHub: params.runtimeHub
      })
    );
    return;
  }

  if (pathname === "/api/runtime/options" && method === "GET") {
    const bankrollParam = requestUrl.searchParams.get("bankrollUsd");
    const bankrollUsd = bankrollParam === null ? undefined : Number(bankrollParam);
    const normalizedBankroll =
      bankrollUsd !== undefined && Number.isFinite(bankrollUsd) ? Math.max(0, bankrollUsd) : undefined;
    const recommendation =
      normalizedBankroll !== undefined ? recommendProfileForBankroll(normalizedBankroll) : undefined;
    const activeProfile = resolveProfileByConfigPath(params.runtimeHub.getConfigPath());

    writeJson(params.res, 200, {
      liveEnabled: params.env.liveTradingEnabled,
      bankrollPresetsUsd: BANKROLL_PRESETS_USD,
      profiles: RUN_PROFILES,
      recommendation: recommendation
        ? {
            bankrollUsd: normalizedBankroll,
            ...recommendation
          }
        : null,
      activeProfileId: activeProfile?.id,
      current: {
        ...params.runtimeHub.getStatusSnapshot(),
        configPath: params.runtimeHub.getConfigPath()
      }
    });
    return;
  }

  if (pathname === "/api/runtime/start" && method === "POST") {
    const body = await readJsonBody(params.req);
    const mode = parseWorkflowMode(body?.mode);
    if (!mode) {
      writeJson(params.res, 400, {
        error: "bad_request",
        message: "mode must be one of: observe, paper, live"
      });
      return;
    }

    const bankrollUsd = toOptionalNumber(body?.bankrollUsd);
    const profileId = normalizeText(body?.profileId);
    const configPathInput = normalizeText(body?.configPath);
    const durationSec = toOptionalNumber(body?.durationSec);
    const stopAfterMs =
      durationSec !== undefined && durationSec > 0 ? Math.floor(durationSec * 1000) : undefined;

    const selectedProfile =
      resolveProfileById(profileId) ??
      resolveProfileByConfigPath(configPathInput) ??
      (bankrollUsd !== undefined ? recommendProfileForBankroll(bankrollUsd) : undefined);
    const configPath =
      selectedProfile?.configPath ?? configPathInput ?? params.runtimeHub.getConfigPath();

    try {
      const cfg = loadAppConfig(configPath);
      await params.runtimeHub.startWorkflow({
        workflowMode: mode,
        cfg,
        configPath,
        stopAfterMs
      });
      writeJson(params.res, 200, {
        ok: true,
        mode,
        configPath,
        profileId: selectedProfile?.id,
        bankrollUsd,
        status: params.runtimeHub.getStatusSnapshot()
      });
    } catch (err) {
      writeJson(params.res, 400, {
        error: "bad_request",
        message: String(err)
      });
    }
    return;
  }

  if (pathname === "/api/runtime/stop" && method === "POST") {
    try {
      await params.runtimeHub.startWorkflow({
        workflowMode: "observe",
        cfg: params.runtimeHub.getConfig(),
        configPath: params.runtimeHub.getConfigPath()
      });
      writeJson(params.res, 200, {
        ok: true,
        status: params.runtimeHub.getStatusSnapshot()
      });
    } catch (err) {
      writeJson(params.res, 400, {
        error: "bad_request",
        message: String(err)
      });
    }
    return;
  }

  if (pathname === "/api/strategy" && method === "GET") {
    writeJson(
      params.res,
      200,
      readStrategyState({
        env: params.env,
        runtimeHub: params.runtimeHub
      })
    );
    return;
  }

  if (pathname.startsWith("/api/mints/") && method === "GET") {
    const mint = decodeURIComponent(pathname.slice("/api/mints/".length));
    const detail = readMintDetail(params.db, mint, params.runtimeHub.getRuntimeState());
    if (!detail) {
      writeJson(params.res, 404, { error: "not_found", message: "mint detail not found" });
      return;
    }
    writeJson(params.res, 200, detail);
    return;
  }

  if (pathname === "/api/analyze" && method === "POST") {
    const body = await readJsonBody(params.req);
    const mint = body && typeof body.mint === "string" ? body.mint.trim() : "";
    if (!mint) {
      writeJson(params.res, 400, { error: "bad_request", message: "mint is required" });
      return;
    }
    const result = await analyzeOnce({
      cfg: params.runtimeHub.getConfig(),
      env: params.env,
      logger: params.logger,
      mint
    });
    writeJson(params.res, 200, {
      report: JSON.parse(result.reportJson),
      timestamp: Date.now()
    });
    return;
  }

  if (pathname === "/api/health" && method === "GET") {
    writeJson(params.res, 200, { ok: true });
    return;
  }

  if (method === "GET" && fs.existsSync(params.staticRoot)) {
    if (await tryServeStatic(params.res, params.staticRoot, pathname)) return;
  }

  writeJson(params.res, 404, { error: "not_found", message: "route not found" });
}

function handleSse(res: ServerResponse, runtimeHub: RuntimeHub): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const send = (event: WebRuntimeEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  send({
    type: "ready",
    atMs: Date.now(),
    data: runtimeHub.getStatusSnapshot()
  });

  const unsubscribe = runtimeHub.subscribe(send);
  res.on("close", () => {
    unsubscribe();
    res.end();
  });
}

async function tryServeStatic(
  res: ServerResponse,
  staticRoot: string,
  pathname: string
): Promise<boolean> {
  const resolved = safeResolveStaticPath(staticRoot, pathname);
  if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    await streamFile(res, resolved);
    return true;
  }

  const indexPath = path.join(staticRoot, "index.html");
  if (fs.existsSync(indexPath)) {
    await streamFile(res, indexPath, "text/html; charset=utf-8");
    return true;
  }

  return false;
}

function safeResolveStaticPath(staticRoot: string, pathname: string): string | null {
  const target = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(staticRoot, `.${target}`);
  return resolved.startsWith(staticRoot) ? resolved : null;
}

async function streamFile(res: ServerResponse, filePath: string, forcedType?: string): Promise<void> {
  const content = await fs.promises.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": forcedType ?? guessContentType(filePath),
    "Cache-Control": "no-cache"
  });
  res.end(content);
}

function guessContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache"
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 256 * 1024) throw new Error("request body too large");
    chunks.push(part);
  }

  if (!chunks.length) return null;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;

  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function parseBoolParam(url: URL, key: string, fallback: boolean): boolean {
  const value = url.searchParams.get(key);
  if (value === null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseIntParam(url: URL, key: string, fallback: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function parseOptionalIntParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : undefined;
}

function parseWorkflowMode(value: unknown): WebWorkflowMode | undefined {
  const mode = normalizeText(value)?.toLowerCase();
  if (!mode) return undefined;
  if (mode === "observe" || mode === "paper" || mode === "live") return mode;
  return undefined;
}

function normalizeText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
