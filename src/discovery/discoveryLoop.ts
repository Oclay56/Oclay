import crypto from "node:crypto";
import type { Logger } from "pino";
import type { AppConfig } from "../config/schema";
import type { DexPairSnapshot } from "../domain/types";
import type { Repos } from "../storage/repos";
import type { DexScreenerClient } from "../providers/dexscreener";
import { sleepMs } from "../utils/time";

export interface DiscoveryHandlers {
  onCandidate: (params: {
    candidateId?: string;
    mint: string;
    bestPair: DexPairSnapshot | null;
    source: string;
    detectedAtMs?: number;
    txSig?: string;
  }) => void;
}

export async function discoveryLoop(params: {
  cfg: AppConfig;
  dex: DexScreenerClient;
  repos: Repos;
  logger: Logger;
  handlers: DiscoveryHandlers;
  stopSignal: AbortSignal;
  fallbackOnly?: boolean;
  shouldRunFallback?: () => boolean;
  pollIntervalMs?: number;
}): Promise<void> {
  const { cfg, dex, repos, logger, handlers, stopSignal } = params;
  const fallbackOnly = params.fallbackOnly ?? false;
  const pollIntervalMs = params.pollIntervalMs ?? cfg.discovery.pollIntervalMs;

  const pairCache = new Map<
    string,
    { fetchedAtMs: number; bestPair: DexPairSnapshot | null; errCount: number }
  >();
  let discoveryBackoffUntilMs = 0;
  let rateErrStreak = 0;

  while (!stopSignal.aborted) {
    const loopStart = Date.now();
    try {
      if (Date.now() < discoveryBackoffUntilMs) {
        await sleepMs(Math.min(pollIntervalMs, discoveryBackoffUntilMs - Date.now()), stopSignal);
        continue;
      }
      if (fallbackOnly && params.shouldRunFallback && !params.shouldRunFallback()) {
        await sleepMs(Math.max(250, pollIntervalMs), stopSignal);
        continue;
      }

      repos.deleteExpiredBlocks(Date.now());

      const profiles = await dex.getLatestTokenProfiles(stopSignal);
      rateErrStreak = 0;
      const solProfiles = profiles.filter((p) => p.chainId === "solana").slice(0, cfg.discovery.maxNewTokensPerPoll);

      for (const p of solProfiles) {
        if (stopSignal.aborted) break;
        const mint = p.tokenAddress;
        repos.upsertToken({ mint, seenAtMs: Date.now(), source: "dexscreener.latest" });
        if (repos.isBlocked(mint, Date.now())) continue;

        let cached = pairCache.get(mint);
        if (cached && Date.now() - cached.fetchedAtMs < cfg.discovery.pairCacheTtlMs) {
          const detectedAtMs = Date.now();
          handlers.onCandidate({
            candidateId: makeFallbackCandidateId(mint, "dexscreener.cached", detectedAtMs),
            mint,
            bestPair: cached.bestPair,
            source: "dexscreener.cached",
            detectedAtMs
          });
          continue;
        }

        try {
          const pairs = await dex.getTokenPairs(mint, stopSignal);
          const bestPair = dex.selectBestPair({
            pairs,
            minLiquidityUsd: cfg.discovery.minPairLiquidityUsd,
            dexAllowlist: cfg.discovery.dexAllowlist,
            preferMints: [cfg.assets.baseAssetMint, cfg.assets.quoteAssetMint]
          });
          pairCache.set(mint, { fetchedAtMs: Date.now(), bestPair, errCount: 0 });
          const detectedAtMs = Date.now();
          handlers.onCandidate({
            candidateId: makeFallbackCandidateId(mint, "dexscreener.latest", detectedAtMs),
            mint,
            bestPair,
            source: "dexscreener.latest",
            detectedAtMs
          });
        } catch (err) {
          const prev = pairCache.get(mint);
          const errCount = (prev?.errCount ?? 0) + 1;
          pairCache.set(mint, { fetchedAtMs: Date.now(), bestPair: null, errCount });
          logger.debug({ mint, err: String(err), errCount }, "failed to fetch token pairs");
          if (isRateOrTimeoutError(err)) {
            rateErrStreak++;
            if (rateErrStreak >= 5) {
              const backoffMs = Math.min(120_000, 5_000 * rateErrStreak);
              discoveryBackoffUntilMs = Date.now() + backoffMs;
              logger.warn({ rateErrStreak, backoffMs }, "discovery pair fetch pressure; backing off");
            }
          }
        }
      }
    } catch (err) {
      if (isRateOrTimeoutError(err)) {
        rateErrStreak++;
        const backoffMs = Math.min(120_000, 7_000 * rateErrStreak);
        discoveryBackoffUntilMs = Date.now() + backoffMs;
        logger.warn({ rateErrStreak, backoffMs, err: String(err) }, "discovery rate/timeout pressure; backing off");
      }
      if (!stopSignal.aborted) logger.warn({ err: String(err) }, "discovery loop error");
    }

    const elapsed = Date.now() - loopStart;
    const sleepFor = Math.max(250, pollIntervalMs - elapsed);
    await sleepMs(sleepFor, stopSignal);
  }
}

function makeFallbackCandidateId(mint: string, source: string, atMs: number): string {
  return crypto.createHash("sha1").update(`${mint}:${source}:${atMs}`).digest("hex").slice(0, 24);
}

function isRateOrTimeoutError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("aborted")
  );
}
