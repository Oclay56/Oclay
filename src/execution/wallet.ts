import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";

export function loadKeypairFromFile(filePath: string): Keypair {
  const resolved = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  const arr = JSON.parse(raw) as number[];
  if (!Array.isArray(arr) || arr.length < 32) {
    throw new Error("Invalid keypair file (expected JSON array of bytes).");
  }
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

