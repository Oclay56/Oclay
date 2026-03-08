import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
  type Mint
} from "@solana/spl-token";
import type { AppConfig } from "../config/schema";
import type { RiskFlag } from "../domain/flags";
import type { SolanaRpc } from "../providers/solanaRpc";
import { analyzeToken2022Extensions } from "./token2022";

export interface MintSafetyResult {
  flags: RiskFlag[];
  tokenProgram: "spl-token" | "token-2022" | "unknown";
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  decimals?: number;
  supply?: bigint;
  mintInfo?: Mint;
}

export async function analyzeMintSafety(cfg: AppConfig, rpc: SolanaRpc, mintStr: string): Promise<MintSafetyResult> {
  const flags: RiskFlag[] = [];
  const mintPk = new PublicKey(mintStr);
  const acct = await rpc.getAccountInfo(mintPk.toBase58());
  if (!acct) return { flags, tokenProgram: "unknown" };

  let tokenProgram: MintSafetyResult["tokenProgram"] = "unknown";
  let programId = acct.owner;
  if (acct.owner.equals(TOKEN_PROGRAM_ID)) tokenProgram = "spl-token";
  if (acct.owner.equals(TOKEN_2022_PROGRAM_ID)) tokenProgram = "token-2022";

  let mintInfo: Mint | undefined;
  try {
    mintInfo = unpackMint(mintPk, acct, programId);
  } catch {
    // Some mints might be invalid or RPC may fail; treat as unknown.
    return { flags, tokenProgram };
  }

  const mintAuthority = mintInfo.mintAuthority ? mintInfo.mintAuthority.toBase58() : null;
  const freezeAuthority = mintInfo.freezeAuthority ? mintInfo.freezeAuthority.toBase58() : null;

  if (mintAuthority) flags.push("HAS_MINT_AUTH");
  if (freezeAuthority) flags.push("HAS_FREEZE_AUTH");

  if (tokenProgram === "token-2022") {
    const ext = analyzeToken2022Extensions(cfg, mintInfo);
    flags.push(...ext.flags);
  }

  return {
    flags,
    tokenProgram,
    mintAuthority,
    freezeAuthority,
    decimals: mintInfo.decimals,
    supply: mintInfo.supply,
    mintInfo
  };
}
