import {
  AccountState,
  getDefaultAccountState,
  getNonTransferable,
  getTransferFeeConfig,
  getTransferHook,
  type Mint
} from "@solana/spl-token";
import type { AppConfig } from "../config/schema";
import type { RiskFlag } from "../domain/flags";

export function analyzeToken2022Extensions(cfg: AppConfig, mintInfo: Mint): { flags: RiskFlag[]; metrics: Record<string, unknown> } {
  const flags: RiskFlag[] = [];
  const metrics: Record<string, unknown> = {};

  const transferHook = getTransferHook(mintInfo);
  if (transferHook) {
    flags.push("TOKEN2022_TRANSFER_HOOK");
    metrics.transferHookProgramId = transferHook.programId.toBase58();
  }

  const nonTransferable = getNonTransferable(mintInfo);
  if (nonTransferable) flags.push("NON_TRANSFERABLE");

  const defState = getDefaultAccountState(mintInfo);
  if (defState) {
    metrics.defaultAccountState = String(defState.state);
    if (defState.state === AccountState.Frozen) flags.push("DEFAULT_FROZEN");
  }

  const tf = getTransferFeeConfig(mintInfo);
  if (tf) {
    const bps = Math.max(tf.olderTransferFee.transferFeeBasisPoints, tf.newerTransferFee.transferFeeBasisPoints);
    metrics.transferFeeBasisPoints = bps;
    if (bps > cfg.analysis.maxToken2022TransferFeeBps) flags.push("HIGH_TRANSFER_FEE");
  }

  return { flags, metrics };
}

