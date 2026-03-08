import { describe, expect, test } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  AccountState,
  DEFAULT_ACCOUNT_STATE_SIZE,
  ExtensionType,
  NON_TRANSFERABLE_SIZE,
  TRANSFER_FEE_CONFIG_SIZE,
  TRANSFER_HOOK_SIZE,
  TransferFeeConfigLayout,
  type Mint
} from "@solana/spl-token";
import { analyzeToken2022Extensions } from "../../src/analyzer/token2022";

function tlvEntry(type: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(type, 0);
  header.writeUInt16LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

describe("Token-2022 extension detection", () => {
  test("detects transfer hook, non-transferable, default frozen, and high transfer fee", () => {
    const cfg: any = { analysis: { maxToken2022TransferFeeBps: 50 } };

    const transferHookPayload = Buffer.alloc(TRANSFER_HOOK_SIZE, 0);
    const nonTransferablePayload = Buffer.alloc(NON_TRANSFERABLE_SIZE, 0);
    const defaultStatePayload = Buffer.alloc(DEFAULT_ACCOUNT_STATE_SIZE, 0);
    defaultStatePayload.writeUInt8(AccountState.Frozen, 0);

    const tfBuf = Buffer.alloc(TRANSFER_FEE_CONFIG_SIZE, 0);
    const pk = new PublicKey("11111111111111111111111111111111");
    TransferFeeConfigLayout.encode(
      {
        transferFeeConfigAuthority: pk,
        withdrawWithheldAuthority: pk,
        withheldAmount: 0n,
        olderTransferFee: { epoch: 0n, maximumFee: 0n, transferFeeBasisPoints: 1000 },
        newerTransferFee: { epoch: 0n, maximumFee: 0n, transferFeeBasisPoints: 1000 }
      } as any,
      tfBuf
    );

    const tlvData = Buffer.concat([
      tlvEntry(ExtensionType.TransferHook, transferHookPayload),
      tlvEntry(ExtensionType.NonTransferable, nonTransferablePayload),
      tlvEntry(ExtensionType.DefaultAccountState, defaultStatePayload),
      tlvEntry(ExtensionType.TransferFeeConfig, tfBuf)
    ]);

    const mintInfo = { tlvData } as any as Mint;
    const res = analyzeToken2022Extensions(cfg, mintInfo);

    expect(res.flags).toContain("TOKEN2022_TRANSFER_HOOK");
    expect(res.flags).toContain("NON_TRANSFERABLE");
    expect(res.flags).toContain("DEFAULT_FROZEN");
    expect(res.flags).toContain("HIGH_TRANSFER_FEE");
  });
});

