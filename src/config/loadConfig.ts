import fs from "node:fs";
import path from "node:path";
import { configSchema, type AppConfig } from "./schema";

export const LIVE_TRADING_CONFIRM_PHRASE = "I_UNDERSTAND_THIS_CAN_LOSE_MONEY";

export interface RuntimeEnv {
  rpcUrl: string;
  rpcConcurrency: number;
  rpcIntervalCap?: number;
  rpcIntervalMs?: number;
  dbPath: string;
  configPath: string;
  logLevel: string;
  maxConcurrency: number;
  killSwitch: boolean;
  liveTradingEnabled: boolean;
  walletKeypairPath?: string;
  jupBaseUrl: string;
  jupApiKey?: string;
  dexScreenerBaseUrl: string;
  heliusWsUrl?: string;
  raydiumApiBaseUrl?: string;
  telemetryEnabled?: boolean;
  dashboardLogLevel: string;
  dashboardLogTarget: "stdout" | "stderr" | "file";
  dashboardLogPath?: string;
}

function readEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export function loadRuntimeEnv(): RuntimeEnv {
  const rpcUrl = readEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")!;
  const rpcConcurrencyRaw = Number(readEnv("RPC_CONCURRENCY", "2"));
  const rpcIntervalCapRaw = Number(readEnv("RPC_INTERVAL_CAP", "8"));
  const rpcIntervalMsRaw = Number(readEnv("RPC_INTERVAL_MS", "1000"));
  const rpcConcurrency = Number.isFinite(rpcConcurrencyRaw) && rpcConcurrencyRaw > 0 ? Math.floor(rpcConcurrencyRaw) : 2;
  const rpcIntervalCap = Number.isFinite(rpcIntervalCapRaw) && rpcIntervalCapRaw > 0 ? Math.floor(rpcIntervalCapRaw) : undefined;
  const rpcIntervalMs = Number.isFinite(rpcIntervalMsRaw) && rpcIntervalMsRaw > 0 ? Math.floor(rpcIntervalMsRaw) : undefined;

  const dbPath = readEnv("DB_PATH", "data/oclay.sqlite")!;
  const configPath = readEnv("CONFIG_PATH", "config/default.json")!;
  const logLevel = readEnv("LOG_LEVEL", "info")!;
  const maxConcurrency = Number(readEnv("MAX_CONCURRENCY", "6"));
  const killSwitchRaw = (readEnv("KILL_SWITCH", "false") || "").toLowerCase();
  const killSwitch = killSwitchRaw === "true";

  const liveTradingRaw = (readEnv("LIVE_TRADING", "false") || "").toLowerCase();
  const liveTradingConfirm = readEnv("LIVE_TRADING_CONFIRM", "") || "";
  const liveTradingEnabled =
    liveTradingRaw === "true" && liveTradingConfirm === LIVE_TRADING_CONFIRM_PHRASE;

  const walletKeypairPath = readEnv("WALLET_KEYPAIR_PATH");

  const jupBaseUrl = readEnv("JUP_BASE_URL", "https://lite-api.jup.ag/ultra/v1")!;
  const jupApiKey = readEnv("JUP_API_KEY");
  const dexScreenerBaseUrl = readEnv("DEXSCREENER_BASE_URL", "https://api.dexscreener.com")!;
  const heliusWsUrl = readEnv("HELIUS_WS_URL");
  const raydiumApiBaseUrl = readEnv("RAYDIUM_API_BASE_URL");
  const telemetryEnabledRaw = readEnv("TELEMETRY_ENABLED");
  const telemetryEnabled =
    telemetryEnabledRaw === undefined ? undefined : ["1", "true", "yes", "on"].includes(telemetryEnabledRaw.toLowerCase());
  const dashboardLogLevel = readEnv("DASHBOARD_LOG_LEVEL", "warn")!;
  const dashboardLogTargetRaw = (readEnv("DASHBOARD_LOG_TARGET", "stderr") || "").toLowerCase();
  const dashboardLogTarget: RuntimeEnv["dashboardLogTarget"] =
    dashboardLogTargetRaw === "stdout" || dashboardLogTargetRaw === "file" ? dashboardLogTargetRaw : "stderr";
  const dashboardLogPath = readEnv("DASHBOARD_LOG_PATH");

  return {
    rpcUrl,
    rpcConcurrency,
    rpcIntervalCap,
    rpcIntervalMs,
    dbPath,
    configPath,
    logLevel,
    maxConcurrency: Number.isFinite(maxConcurrency) && maxConcurrency > 0 ? maxConcurrency : 6,
    killSwitch,
    liveTradingEnabled,
    walletKeypairPath,
    jupBaseUrl,
    jupApiKey,
    dexScreenerBaseUrl,
    heliusWsUrl,
    raydiumApiBaseUrl,
    telemetryEnabled,
    dashboardLogLevel,
    dashboardLogTarget,
    dashboardLogPath
  };
}

export function loadAppConfig(configPath: string): AppConfig {
  const resolved = path.resolve(process.cwd(), configPath);
  const raw = fs.readFileSync(resolved, "utf8");
  const json = JSON.parse(raw) as unknown;
  return configSchema.parse(json);
}
