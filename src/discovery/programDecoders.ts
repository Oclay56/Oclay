import crypto from "node:crypto";
import bs58 from "bs58";
import type { StreamEventKind } from "./streamParsers";

const RAYDIUM_CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNfS2bY2Gb5j2qWQY3X2Y9E7";
const RAYDIUM_CLMM_PROGRAM = "CAMMCzo5YL8w4VFF8KVHrK22GGUQxZ3Gx2wQv6qf9A8";
const METEORA_DLMM_PROGRAM = "Eo7WjKq67rjJQS1n3rY7AEvtTDHkJNNZ4wNGyreAx7An";

export interface ProgramDecoderResult {
  kind: StreamEventKind;
  confidence: number;
  reason: string;
}

export function decodeProgramEvent(params: {
  programId: string;
  tx: any;
  logs: string[];
  strictMode: boolean;
}): ProgramDecoderResult | null {
  const { programId, tx, logs, strictMode } = params;
  const decoded = decodeInstructions(tx).filter((ix) => ix.programId === programId);
  if (!decoded.length) return null;

  for (const ix of decoded) {
    const byDiscriminator = decodeByDiscriminator(programId, ix.data);
    if (!byDiscriminator) continue;
    if (!hasValidAccountShape(ix.accounts.length, byDiscriminator.kind)) continue;
    return {
      kind: byDiscriminator.kind,
      confidence: byDiscriminator.confidence,
      reason: byDiscriminator.reason
    };
  }

  if (strictMode) return null;
  const kind = classifyByLogs(logs);
  if (!kind) return null;
  return {
    kind,
    confidence: 0.82,
    reason: "decoder_log_fallback_non_strict"
  };
}

function decodeByDiscriminator(programId: string, data: Buffer): ProgramDecoderResult | null {
  if (data.length <= 0) return null;
  if (programId === RAYDIUM_CPMM_PROGRAM || programId === RAYDIUM_CLMM_PROGRAM) {
    const opcode = Number(data[0] ?? -1);
    if (opcode === 0 || opcode === 1 || opcode === 2) {
      return { kind: "POOL_CREATE", confidence: 0.97, reason: `decoder_opcode:${opcode}:pool_create` };
    }
    if (opcode === 3 || opcode === 4 || opcode === 5 || opcode === 6) {
      return { kind: "LIQ_ADD", confidence: 0.95, reason: `decoder_opcode:${opcode}:liq_add` };
    }
    if (opcode === 7 || opcode === 8 || opcode === 9 || opcode === 10 || opcode === 11) {
      return { kind: "EARLY_SWAP", confidence: 0.95, reason: `decoder_opcode:${opcode}:swap` };
    }
  }

  if (programId === METEORA_DLMM_PROGRAM || programId === RAYDIUM_CPMM_PROGRAM || programId === RAYDIUM_CLMM_PROGRAM) {
    if (hasAnchorDiscriminator(data, ["initialize", "initialize_pool", "create_pool"])) {
      return { kind: "POOL_CREATE", confidence: 0.96, reason: "decoder_anchor:pool_create" };
    }
    if (hasAnchorDiscriminator(data, ["add_liquidity", "deposit", "increase_liquidity"])) {
      return { kind: "LIQ_ADD", confidence: 0.95, reason: "decoder_anchor:liq_add" };
    }
    if (hasAnchorDiscriminator(data, ["swap", "swap_base_input", "swap_v2"])) {
      return { kind: "EARLY_SWAP", confidence: 0.96, reason: "decoder_anchor:swap" };
    }
  }

  return null;
}

function hasAnchorDiscriminator(data: Buffer, names: string[]): boolean {
  if (data.length < 8) return false;
  const prefix = data.subarray(0, 8);
  return names.some((name) => anchorDiscriminator(`global:${name}`).equals(prefix));
}

function anchorDiscriminator(name: string): Buffer {
  return crypto.createHash("sha256").update(name).digest().subarray(0, 8);
}

function hasValidAccountShape(accountCount: number, kind: StreamEventKind): boolean {
  if (kind === "POOL_CREATE") return accountCount >= 4;
  if (kind === "LIQ_ADD") return accountCount >= 6;
  return accountCount >= 8;
}

function classifyByLogs(logs: string[]): StreamEventKind | null {
  const text = logs.join(" ").toLowerCase();
  if (!text) return null;
  if (text.includes("create pool") || text.includes("initialize") || text.includes("pool_create")) return "POOL_CREATE";
  if (text.includes("add liquidity") || text.includes("add_liquidity") || text.includes("deposit")) return "LIQ_ADD";
  if (text.includes("swap") || text.includes("trade")) return "EARLY_SWAP";
  return null;
}

function decodeInstructions(tx: any): Array<{ programId: string; accounts: string[]; data: Buffer }> {
  const message = tx?.transaction?.message;
  if (!message) return [];
  const accountKeys = normalizeAccountKeys(message);
  const out: Array<{ programId: string; accounts: string[]; data: Buffer }> = [];
  const instructions = Array.isArray(message.instructions)
    ? message.instructions
    : Array.isArray(message.compiledInstructions)
      ? message.compiledInstructions
      : [];

  for (const ix of instructions) {
    const parsedPid = ix?.programId ? String(ix.programId) : "";
    const pidFromIdx =
      ix?.programIdIndex !== undefined ? accountKeys[Number(ix.programIdIndex)] ?? "" : "";
    const programId = parsedPid || pidFromIdx;
    if (!programId) continue;

    const accountRefs = Array.isArray(ix?.accounts) ? ix.accounts : [];
    const accounts = accountRefs
      .map((a: any) => {
        if (typeof a === "string") return a;
        if (typeof a === "number") return accountKeys[a] ?? "";
        return "";
      })
      .filter((a: string) => a.length > 0);
    const data = decodeInstructionData(ix?.data);
    out.push({ programId, accounts, data });
  }

  return out;
}

function decodeInstructionData(data: unknown): Buffer {
  if (data === null || data === undefined) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.from(data);
  const raw = String(data).trim();
  if (!raw) return Buffer.alloc(0);
  try {
    return Buffer.from(bs58.decode(raw));
  } catch {
    // continue
  }
  try {
    return Buffer.from(raw, "base64");
  } catch {
    // continue
  }
  try {
    return Buffer.from(raw.replace(/^0x/, ""), "hex");
  } catch {
    return Buffer.alloc(0);
  }
}

function normalizeAccountKeys(message: any): string[] {
  const raw = Array.isArray(message?.accountKeys)
    ? message.accountKeys
    : Array.isArray(message?.staticAccountKeys)
      ? message.staticAccountKeys
      : [];
  return raw.map((k: any) => {
    if (typeof k === "string") return k;
    if (k?.pubkey) return String(k.pubkey);
    if (k?.toBase58) return String(k.toBase58());
    return String(k ?? "");
  });
}
