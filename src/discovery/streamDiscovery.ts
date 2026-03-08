import PQueue from "p-queue";
import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { SolanaRpc } from "../providers/solanaRpc";
import type { HeliusStreamClient, HeliusLogEvent } from "../providers/heliusStream";
import type { Repos } from "../storage/repos";
import { parseStreamCandidates, type StreamEventKind, type StreamParsePath } from "./streamParsers";
import { sleepMs } from "../utils/time";

export interface StreamDiscoveryHandlers {
  onCandidate: (params: {
    candidateId: string;
    mint: string;
    source: string;
    detectedAtMs: number;
    txSig?: string;
    eventKind?: StreamEventKind;
    confidence?: number;
    parsePath?: StreamParsePath;
    reason?: string;
  }) => void;
}

export interface StreamDiscoveryHandle {
  stop: () => Promise<void>;
  lastEventAtMs: () => number;
}

export async function startStreamDiscovery(params: {
  cfg: AppConfig;
  rpc: SolanaRpc;
  stream: HeliusStreamClient;
  repos: Repos;
  logger: Logger;
  handlers: StreamDiscoveryHandlers;
  stopSignal: AbortSignal;
}): Promise<StreamDiscoveryHandle> {
  const { cfg, rpc, stream, repos, logger, handlers, stopSignal } = params;
  const dedupeByMint = new Map<string, number>();
  const dedupeByCandidate = new Map<string, number>();
  const sigSeen = new Set<string>();
  const queue = new PQueue({
    concurrency: 1,
    intervalCap: Math.max(1, Math.floor(cfg.discovery.stream.maxCandidatesPerMinute)),
    interval: 60_000,
    carryoverConcurrencyCount: true
  });
  let lastEvent = 0;
  let reconnecting = false;
  let reconnectDelayMs = cfg.discovery.stream.reconnectMinMs;
  const reconnectMinMs = cfg.discovery.stream.reconnectMinMs;
  const reconnectMaxMs = cfg.discovery.stream.reconnectMaxMs;
  const candidateTtlMs = 120_000;

  const onEvent = (evt: HeliusLogEvent) => {
    lastEvent = Date.now();
    void queue.add(() => processEvent(evt)).catch((err) => {
      logger.debug({ err: String(err), sig: evt.signature }, "stream event processing failed");
    });
  };

  const processEvent = async (evt: HeliusLogEvent) => {
    if (stopSignal.aborted) return;
    if (sigSeen.has(evt.signature)) return;
    sigSeen.add(evt.signature);
    if (sigSeen.size > 10_000) {
      const first = sigSeen.values().next().value;
      if (first) sigSeen.delete(first);
    }

    const tx = await rpc.getTransactionWithRetry(evt.signature, { retries: 4, delayMs: 250 });
    if (!tx) return;
    const candidates = parseStreamCandidates({ cfg, event: evt, tx });
    if (!candidates.length) return;

    const now = Date.now();
    trimDedupeMap(dedupeByMint, now - candidateTtlMs);
    trimDedupeMap(dedupeByCandidate, now - candidateTtlMs);

    for (const c of candidates) {
      if (stopSignal.aborted) return;
      if (c.mint === cfg.assets.baseAssetMint || c.mint === cfg.assets.quoteAssetMint) continue;
      if ((dedupeByCandidate.get(c.candidateId) ?? 0) > now - candidateTtlMs) continue;
      if ((dedupeByMint.get(c.mint) ?? 0) > now - candidateTtlMs) continue;

      dedupeByCandidate.set(c.candidateId, now);
      dedupeByMint.set(c.mint, now);
      repos.upsertToken({ mint: c.mint, seenAtMs: now, source: c.source });
      if (repos.isBlocked(c.mint, now)) continue;

      handlers.onCandidate({
        candidateId: c.candidateId,
        mint: c.mint,
        source: c.source,
        detectedAtMs: evt.atMs,
        txSig: evt.signature,
        eventKind: c.kind,
        confidence: c.confidence,
        parsePath: c.parsePath,
        reason: c.reason
      });
    }
  };

  async function reconnect(reason: string): Promise<void> {
    if (reconnecting || stopSignal.aborted) return;
    reconnecting = true;
    while (!stopSignal.aborted) {
      const waitMs = Math.max(reconnectMinMs, Math.min(reconnectMaxMs, reconnectDelayMs));
      logger.warn({ reason, waitMs }, "stream reconnect scheduled");
      await sleepMs(waitMs, stopSignal).catch(() => undefined);
      if (stopSignal.aborted) break;

      try {
        await stream.stop();
        await stream.start(cfg.discovery.stream.programAllowlist, onEvent);
        reconnectDelayMs = reconnectMinMs;
        lastEvent = Date.now();
        logger.warn({ reason }, "stream reconnected");
        break;
      } catch (err) {
        reconnectDelayMs = Math.min(reconnectMaxMs, reconnectDelayMs * 2);
        logger.warn({ reason, err: String(err), nextDelayMs: reconnectDelayMs }, "stream reconnect failed");
      }
    }
    reconnecting = false;
  }

  await stream.start(cfg.discovery.stream.programAllowlist, onEvent);

  const healthTimer = setInterval(() => {
    if (stopSignal.aborted) return;
    if (lastEvent <= 0) return;
    if (Date.now() - lastEvent > cfg.discovery.stream.staleFailoverMs) {
      void reconnect("stale_event_stream");
    }
  }, Math.max(1_000, Math.floor(reconnectMinMs)));
  healthTimer.unref?.();

  const stop = async () => {
    clearInterval(healthTimer);
    queue.pause();
    queue.clear();
    await stream.stop();
  };

  stopSignal.addEventListener("abort", () => {
    void stop();
  });

  return {
    stop,
    lastEventAtMs: () => lastEvent
  };
}

function trimDedupeMap(m: Map<string, number>, minKeepMs: number): void {
  for (const [k, v] of m) {
    if (v < minKeepMs) m.delete(k);
  }
}
