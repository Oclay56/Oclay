import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { RuntimeEnv } from "../config/loadConfig";
import { runBot } from "../runtime/main";
import type {
  RuntimeDashboardState,
  RuntimeDashboardStatePatch
} from "../runtime/dashboardState";

export type WebWorkflowMode = "observe" | "paper" | "live";

export interface WebRuntimeStatusSnapshot {
  workflowMode: WebWorkflowMode;
  dashboardMode: "paper" | "live";
  botRunning: boolean;
  botStartedAtMs?: number;
  botStoppedAtMs?: number;
  lastRuntimePatchAtMs?: number;
  lastBotError?: string;
  subscriberCount: number;
}

export interface WebRuntimeEvent {
  type: "ready" | "patch" | "status" | "heartbeat";
  atMs: number;
  data?: RuntimeDashboardStatePatch | WebRuntimeStatusSnapshot;
}

type RuntimeSubscriber = (event: WebRuntimeEvent) => void;

export interface StartWorkflowParams {
  workflowMode: WebWorkflowMode;
  cfg: AppConfig;
  configPath: string;
  stopAfterMs?: number;
}

export class RuntimeHub {
  private readonly subscribers = new Set<RuntimeSubscriber>();
  private runtimeState: RuntimeDashboardState = {};
  private workflowMode: WebWorkflowMode;
  private dashboardMode: "paper" | "live";
  private cfg: AppConfig;
  private configPath: string;
  private stopAfterMs?: number;

  private botRunning = false;
  private botStartedAtMs?: number;
  private botStoppedAtMs?: number;
  private lastRuntimePatchAtMs?: number;
  private lastBotError?: string;
  private botAbort?: AbortController;
  private botPromise?: Promise<void>;

  constructor(
    initialWorkflowMode: WebWorkflowMode,
    initialCfg: AppConfig,
    private readonly env: RuntimeEnv,
    private readonly logger: Logger,
    initialStopAfterMs?: number,
    initialConfigPath?: string
  ) {
    this.workflowMode = initialWorkflowMode;
    this.dashboardMode = initialWorkflowMode === "live" ? "live" : "paper";
    this.cfg = initialCfg;
    this.configPath = initialConfigPath ?? env.configPath;
    this.stopAfterMs = initialStopAfterMs;
  }

  getRuntimeState(): RuntimeDashboardState {
    return this.runtimeState;
  }

  getConfig(): AppConfig {
    return this.cfg;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getDashboardMode(): "paper" | "live" {
    return this.dashboardMode;
  }

  getStatusSnapshot(): WebRuntimeStatusSnapshot {
    return {
      workflowMode: this.workflowMode,
      dashboardMode: this.dashboardMode,
      botRunning: this.botRunning,
      botStartedAtMs: this.botStartedAtMs,
      botStoppedAtMs: this.botStoppedAtMs,
      lastRuntimePatchAtMs: this.lastRuntimePatchAtMs,
      lastBotError: this.lastBotError,
      subscriberCount: this.subscribers.size
    };
  }

  subscribe(listener: RuntimeSubscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  emitReady(): void {
    this.broadcast({
      type: "ready",
      atMs: Date.now(),
      data: this.getStatusSnapshot()
    });
  }

  emitHeartbeat(): void {
    this.broadcast({
      type: "heartbeat",
      atMs: Date.now(),
      data: this.getStatusSnapshot()
    });
  }

  async start(): Promise<void> {
    if (this.workflowMode === "observe" || this.botPromise) return;
    await this.startWorkflow({
      workflowMode: this.workflowMode,
      cfg: this.cfg,
      configPath: this.configPath,
      stopAfterMs: this.stopAfterMs
    });
  }

  async startWorkflow(params: StartWorkflowParams): Promise<void> {
    if (params.workflowMode === "live" && !this.env.liveTradingEnabled) {
      throw new Error("LIVE_TRADING flags are not enabled in the environment.");
    }

    await this.stopWorkflow();

    this.workflowMode = params.workflowMode;
    this.dashboardMode = params.workflowMode === "live" ? "live" : "paper";
    this.cfg = params.cfg;
    this.configPath = params.configPath;
    this.stopAfterMs = params.stopAfterMs;
    this.runtimeState = {};
    this.lastRuntimePatchAtMs = undefined;
    this.lastBotError = undefined;

    if (params.workflowMode === "observe") {
      this.botRunning = false;
      this.botStoppedAtMs = Date.now();
      this.broadcastStatus();
      return;
    }

    this.botAbort = new AbortController();
    this.botRunning = true;
    this.botStartedAtMs = Date.now();
    this.botStoppedAtMs = undefined;
    this.broadcastStatus();

    const envForRun: RuntimeEnv = {
      ...this.env,
      configPath: params.configPath
    };

    let runPromise: Promise<void>;
    runPromise = runBot({
      cfg: params.cfg,
      env: envForRun,
      logger: this.logger,
      forcePaper: params.workflowMode === "paper",
      stopAfterMs: params.stopAfterMs,
      registerSignalHandlers: false,
      externalStopSignal: this.botAbort.signal,
      onRuntimeDashboardState: (patch) => this.mergeAndBroadcastPatch(patch)
    })
      .catch((err) => {
        this.lastBotError = String(err);
        this.logger.error({ err: this.lastBotError }, "web workflow bot failed");
      })
      .finally(() => {
        if (this.botPromise !== runPromise) return;
        this.botRunning = false;
        this.botStoppedAtMs = Date.now();
        this.botAbort = undefined;
        this.botPromise = undefined;
        this.broadcastStatus();
      });

    this.botPromise = runPromise;
  }

  async stopWorkflow(): Promise<void> {
    if (!this.botPromise) return;
    const active = this.botPromise;
    this.botAbort?.abort();
    try {
      await active;
    } catch {
      // swallowed: botPromise catch already records runtime error
    }
  }

  private mergeAndBroadcastPatch(patch: RuntimeDashboardStatePatch): void {
    mergeRuntimeDashboardState(this.runtimeState, patch);
    this.lastRuntimePatchAtMs = Date.now();
    this.broadcast({
      type: "patch",
      atMs: this.lastRuntimePatchAtMs,
      data: patch
    });
  }

  private broadcastStatus(): void {
    this.broadcast({
      type: "status",
      atMs: Date.now(),
      data: this.getStatusSnapshot()
    });
  }

  private broadcast(event: WebRuntimeEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch (err) {
        this.logger.debug({ err: String(err) }, "web runtime subscriber failed");
      }
    }
  }
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
