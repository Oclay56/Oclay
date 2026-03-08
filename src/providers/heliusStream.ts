import { Connection, PublicKey, type Finality, type Logs } from "@solana/web3.js";
import type { Logger } from "pino";

export interface HeliusStreamConfig {
  rpcHttpUrl: string;
  wsUrl?: string;
  commitment?: Finality;
}

export interface HeliusLogEvent {
  programId: string;
  signature: string;
  slot: number;
  logs: string[];
  atMs: number;
}

export class HeliusStreamClient {
  private readonly connection: Connection;
  private readonly subIds: number[] = [];
  private running = false;

  constructor(private readonly cfg: HeliusStreamConfig, private readonly logger: Logger) {
    this.connection = new Connection(cfg.rpcHttpUrl, {
      commitment: cfg.commitment ?? "confirmed",
      disableRetryOnRateLimit: true,
      wsEndpoint: cfg.wsUrl
    });
  }

  async start(programIds: string[], onEvent: (event: HeliusLogEvent) => void): Promise<void> {
    if (this.running) await this.stop();
    this.running = true;
    let subscribed = 0;
    for (const pid of programIds) {
      try {
        const pubkey = new PublicKey(pid);
        const subId = this.connection.onLogs(
          pubkey,
          (logs: Logs, ctx) => {
            if (!this.running) return;
            onEvent({
              programId: pid,
              signature: logs.signature,
              slot: ctx.slot,
              logs: logs.logs ?? [],
              atMs: Date.now()
            });
          },
          this.cfg.commitment ?? "confirmed"
        );
        this.subIds.push(subId);
        subscribed++;
      } catch (err) {
        this.logger.warn({ pid, err: String(err) }, "helius stream subscribe failed");
      }
    }
    if (subscribed <= 0) {
      this.running = false;
      throw new Error("no_stream_subscriptions_established");
    }
    this.logger.info({ subs: this.subIds.length }, "helius stream started");
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const id of this.subIds.splice(0)) {
      try {
        await this.connection.removeOnLogsListener(id);
      } catch {
        // ignore
      }
    }
    this.logger.info("helius stream stopped");
  }

  isRunning(): boolean {
    return this.running;
  }
}
