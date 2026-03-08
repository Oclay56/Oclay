import crypto from "node:crypto";
import type { AppConfig } from "../config/schema";
import type { HeliusLogEvent } from "../providers/heliusStream";
import { decodeProgramEvent } from "./programDecoders";

export type StreamEventKind = "POOL_CREATE" | "LIQ_ADD" | "EARLY_SWAP";
export type StreamParsePath = "instruction" | "heuristic";

export interface StreamParsedCandidate {
  candidateId: string;
  mint: string;
  kind: StreamEventKind;
  confidence: number;
  parsePath: StreamParsePath;
  reason: string;
  source: string;
}

export function parseStreamCandidates(params: {
  cfg: AppConfig;
  event: HeliusLogEvent;
  tx: any;
}): StreamParsedCandidate[] {
  const { cfg, event, tx } = params;
  const mode = cfg.discovery.stream.parseMode;
  const minConfidence = cfg.discovery.stream.minCandidateConfidence;
  const heuristicFloor = Math.max(minConfidence, cfg.discovery.stream.decoderFallbackConfidenceFloor);
  const allowedKinds = new Set(cfg.discovery.stream.emitEventKinds);

  const decoderCandidates =
    mode === "heuristic_only"
      ? []
      : parseByInstructionDecoder({
          cfg,
          event,
          tx
        });

  const heuristicCandidates =
    mode === "instruction_only" || decoderCandidates.length > 0
      ? []
      : parseByHeuristic(event, tx);

  const merged = [...decoderCandidates, ...heuristicCandidates];
  const out = new Map<string, StreamParsedCandidate>();

  for (const c of merged) {
    if (!allowedKinds.has(c.kind)) continue;
    const floor = c.parsePath === "instruction" ? minConfidence : heuristicFloor;
    if (c.confidence < floor) continue;
    const key = `${c.mint}:${c.kind}`;
    const prev = out.get(key);
    if (!prev || c.confidence > prev.confidence) out.set(key, c);
  }

  return [...out.values()].sort((a, b) => b.confidence - a.confidence);
}

function parseByInstructionDecoder(params: {
  cfg: AppConfig;
  event: HeliusLogEvent;
  tx: any;
}): StreamParsedCandidate[] {
  const { cfg, event, tx } = params;
  const decoded = decodeProgramEvent({
    programId: event.programId,
    tx,
    logs: event.logs,
    strictMode: cfg.discovery.stream.decoderStrictMode
  });
  if (!decoded) return [];
  const changedMints = extractChangedMints(tx);
  if (!changedMints.length) return [];

  return changedMints.map((mint) => ({
    candidateId: candidateIdFor(event.signature, mint, decoded.kind),
    mint,
    kind: decoded.kind,
    confidence: decoded.confidence,
    parsePath: "instruction" as const,
    reason: decoded.reason,
    source: `helius.stream.${decoded.kind.toLowerCase()}`
  }));
}

function parseByHeuristic(event: HeliusLogEvent, tx: any): StreamParsedCandidate[] {
  const changedMints = extractChangedMints(tx);
  if (!changedMints.length) return [];

  const kind = classifyKind(event.logs);
  if (!kind) return [];

  const baseConfidence =
    kind === "EARLY_SWAP" ? 0.79 : kind === "LIQ_ADD" ? 0.75 : 0.72;
  const confidenceBoost = changedMints.length >= 2 ? 0.05 : 0;
  const confidence = Math.min(0.92, baseConfidence + confidenceBoost);

  return changedMints.map((mint) => ({
    candidateId: candidateIdFor(event.signature, mint, kind),
    mint,
    kind,
    confidence,
    parsePath: "heuristic" as const,
    reason: `heuristic_path:${kind.toLowerCase()}_logs`,
    source: `helius.stream.${kind.toLowerCase()}`
  }));
}

function candidateIdFor(signature: string, mint: string, kind: StreamEventKind): string {
  return crypto.createHash("sha1").update(`${signature}:${mint}:${kind}`).digest("hex").slice(0, 24);
}

function classifyKind(logs: string[]): StreamEventKind | null {
  const text = logs.join(" ").toLowerCase();
  if (!text) return null;
  if (
    text.includes("initialize") ||
    text.includes("init pool") ||
    text.includes("create pool") ||
    text.includes("pool_create")
  ) {
    return "POOL_CREATE";
  }
  if (
    text.includes("add_liquidity") ||
    text.includes("add liquidity") ||
    text.includes("deposit") ||
    text.includes("liquidity")
  ) {
    return "LIQ_ADD";
  }
  if (text.includes("swap") || text.includes("trade")) {
    return "EARLY_SWAP";
  }
  return null;
}

function extractChangedMints(tx: any): string[] {
  const pre = new Map<string, bigint>();
  const post = new Map<string, bigint>();

  for (const b of tx?.meta?.preTokenBalances ?? []) {
    const mint = b?.mint ? String(b.mint) : "";
    if (!mint) continue;
    const k = `${mint}:${String(b?.accountIndex ?? "")}`;
    pre.set(k, tokenAmount(b));
  }

  for (const b of tx?.meta?.postTokenBalances ?? []) {
    const mint = b?.mint ? String(b.mint) : "";
    if (!mint) continue;
    const k = `${mint}:${String(b?.accountIndex ?? "")}`;
    post.set(k, tokenAmount(b));
  }

  const changed = new Set<string>();
  const keys = new Set<string>([...pre.keys(), ...post.keys()]);
  for (const key of keys) {
    const [mint] = key.split(":");
    if (!mint || mint.length < 32) continue;
    if ((pre.get(key) ?? 0n) !== (post.get(key) ?? 0n)) changed.add(mint);
  }
  return [...changed];
}

function tokenAmount(balance: any): bigint {
  const raw = balance?.uiTokenAmount?.amount;
  if (raw === undefined || raw === null) return 0n;
  try {
    return BigInt(String(raw));
  } catch {
    return 0n;
  }
}
