import {
  Connection,
  PublicKey,
  VersionedTransaction,
  type Finality,
  type RpcResponseAndContext,
  type SimulatedTransactionResponse
} from "@solana/web3.js";
import PQueue from "p-queue";

export interface SolanaRpcOptions {
  commitment?: Finality;
  concurrency?: number;
  intervalCap?: number;
  intervalMs?: number;
  disableRetryOnRateLimit?: boolean;
}

export interface SendAndConfirmRawTxOptions {
  confirmTimeoutMs: number;
  skipPreflight?: boolean;
  statusPollIntervalMs?: number;
  resendIntervalMs?: number;
  maxResends?: number;
}

export class SolanaRpc {
  readonly connection: Connection;
  readonly commitment: Finality;
  private readonly queue: PQueue;

  constructor(rpcUrl: string, opts: SolanaRpcOptions = {}) {
    const commitment: Finality = opts.commitment ?? "confirmed";
    const rpcConcurrency = Math.max(1, Math.floor(opts.concurrency ?? 2));

    const intervalCap = opts.intervalCap !== undefined ? Math.floor(opts.intervalCap) : undefined;
    const intervalMs = opts.intervalMs !== undefined ? Math.floor(opts.intervalMs) : undefined;

    this.commitment = commitment;
    this.connection = new Connection(rpcUrl, {
      commitment,
      // Disable web3.js rate-limit retry spam; we apply our own queue/rate limits.
      disableRetryOnRateLimit: opts.disableRetryOnRateLimit ?? true,
      confirmTransactionInitialTimeout: 20_000
    });

    const qOpts: any = { concurrency: rpcConcurrency };
    if (intervalCap && intervalMs && intervalCap > 0 && intervalMs > 0) {
      qOpts.intervalCap = intervalCap;
      qOpts.interval = intervalMs;
      qOpts.carryoverConcurrencyCount = true;
    }
    this.queue = new PQueue(qOpts);
  }

  async getAccountInfo(pubkey: string) {
    return await this.callRpc(() => this.connection.getAccountInfo(new PublicKey(pubkey), this.commitment));
  }

  async getParsedAccountInfo(pubkey: string) {
    return await this.callRpc(() => this.connection.getParsedAccountInfo(new PublicKey(pubkey), this.commitment));
  }

  async getTokenSupply(mint: string) {
    return await this.callRpc(() => this.connection.getTokenSupply(new PublicKey(mint), this.commitment));
  }

  async getTokenLargestAccounts(mint: string) {
    return await this.callRpc(() => this.connection.getTokenLargestAccounts(new PublicKey(mint), this.commitment));
  }

  async getParsedTokenAccountsByOwner(params: { owner: string; mint: string }) {
    return await this.callRpc(() =>
      this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(params.owner),
        { mint: new PublicKey(params.mint) },
        this.commitment
      )
    );
  }

  async getSignaturesForAddress(address: string, opts?: { before?: string; limit?: number }) {
    return await this.callRpc(() =>
      this.connection.getSignaturesForAddress(new PublicKey(address), opts, this.commitment)
    );
  }

  async getTransaction(signature: string, opts?: { maxSupportedTransactionVersion?: number }) {
    return await this.callRpc(() =>
      this.connection.getTransaction(signature, {
        commitment: this.commitment,
        maxSupportedTransactionVersion: opts?.maxSupportedTransactionVersion ?? 0
      })
    );
  }

  async getTransactionWithRetry(
    signature: string,
    opts?: { maxSupportedTransactionVersion?: number; retries?: number; delayMs?: number }
  ) {
    const retries = Math.max(0, Math.floor(opts?.retries ?? 6));
    const delayMs = Math.max(100, Math.floor(opts?.delayMs ?? 500));
    for (let attempt = 0; attempt <= retries; attempt++) {
      const tx = await this.getTransaction(signature, { maxSupportedTransactionVersion: opts?.maxSupportedTransactionVersion ?? 0 });
      if (tx) return tx;
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  }

  async getBalance(pubkey: string) {
    return await this.callRpc(() => this.connection.getBalance(new PublicKey(pubkey), this.commitment));
  }

  async getTokenAccountBalance(pubkey: string) {
    return await this.callRpc(() =>
      this.connection.getTokenAccountBalance(new PublicKey(pubkey), this.commitment)
    );
  }

  async getLatestBlockhash() {
    return await this.callRpc(() => this.connection.getLatestBlockhash(this.commitment));
  }

  async getSignatureStatuses(signatures: string[]) {
    return await this.callRpc(() => this.connection.getSignatureStatuses(signatures, { searchTransactionHistory: true }));
  }

  static decodeBase64Tx(txBase64: string): VersionedTransaction {
    const buf = Buffer.from(txBase64, "base64");
    return VersionedTransaction.deserialize(buf);
  }

  async simulateBase64Tx(txBase64: string): Promise<{
    ok: boolean;
    logs: string[];
    err?: unknown;
    unitsConsumed?: number;
    raw?: RpcResponseAndContext<SimulatedTransactionResponse>;
  }> {
    const tx = SolanaRpc.decodeBase64Tx(txBase64);
    const resp = await this.callRpc(() =>
      this.connection.simulateTransaction(tx, {
        sigVerify: false,
        commitment: this.commitment,
        replaceRecentBlockhash: true
      })
    );
    const logs = resp.value.logs ?? [];
    const err = resp.value.err ?? undefined;
    return {
      ok: err === undefined || err === null,
      logs,
      err,
      unitsConsumed: resp.value.unitsConsumed ?? undefined,
      raw: resp
    };
  }

  async sendAndConfirmRawTx(
    rawTx: Buffer,
    opts: SendAndConfirmRawTxOptions
  ): Promise<{ signature: string; confirmed: boolean; err?: unknown; chainErr?: unknown }> {
    const sendOpts = {
      skipPreflight: opts.skipPreflight ?? true,
      preflightCommitment: this.commitment,
      maxRetries: 0
    } as const;
    const statusPollIntervalMs = Math.max(100, Math.floor(opts.statusPollIntervalMs ?? 750));
    const resendIntervalMs = Math.max(statusPollIntervalMs, Math.floor(opts.resendIntervalMs ?? 2_000));
    const maxResends = Math.max(0, Math.floor(opts.maxResends ?? 0));
    const queueCall = <T>(fn: () => Promise<T>) => this.callRpc(fn);

    const sig = await this.callRpc(() => this.connection.sendRawTransaction(rawTx, sendOpts));

    const confirmed = await waitForConfirmation({
      conn: this.connection,
      queueCall,
      rawTx,
      signature: sig,
      timeoutMs: opts.confirmTimeoutMs,
      commitment: this.commitment,
      sendOpts,
      statusPollIntervalMs,
      resendIntervalMs,
      maxResends
    });
    if (confirmed.status === "timeout") return { signature: sig, confirmed: false, err: "confirm_timeout" };
    if (confirmed.status === "chain_error") {
      return { signature: sig, confirmed: false, err: "chain_error", chainErr: confirmed.chainErr };
    }
    if (confirmed.status === "send_error") {
      return { signature: sig, confirmed: false, err: confirmed.err ?? "send_error" };
    }
    return { signature: sig, confirmed: true };
  }

  private async callRpc<T>(fn: () => Promise<T>): Promise<T> {
    return await this.queue.add(fn);
  }
}

async function waitForConfirmation(params: {
  conn: Connection;
  queueCall: <T>(fn: () => Promise<T>) => Promise<T>;
  rawTx: Buffer;
  signature: string;
  timeoutMs: number;
  commitment: Finality;
  sendOpts: {
    skipPreflight: boolean;
    preflightCommitment: Finality;
    maxRetries: number;
  };
  statusPollIntervalMs: number;
  resendIntervalMs: number;
  maxResends: number;
}): Promise<{ status: "confirmed" | "chain_error" | "timeout" | "send_error"; chainErr?: unknown; err?: unknown }> {
  const {
    conn,
    queueCall,
    rawTx,
    signature,
    timeoutMs,
    statusPollIntervalMs,
    resendIntervalMs,
    maxResends,
    sendOpts
  } = params;
  const start = Date.now();
  let resendCount = 0;
  let nextResendAt = start + resendIntervalMs;
  while (Date.now() - start < timeoutMs) {
    const st = await queueCall(() => conn.getSignatureStatuses([signature], { searchTransactionHistory: true }));
    const s = st.value[0];
    if (s?.err) return { status: "chain_error", chainErr: s.err };
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return { status: "confirmed" };

    if (resendCount < maxResends && Date.now() >= nextResendAt) {
      try {
        await queueCall(() => conn.sendRawTransaction(rawTx, sendOpts));
      } catch (err) {
        if (!isSafeDuplicateSendError(err)) {
          return { status: "send_error", err: String(err) };
        }
      }
      resendCount += 1;
      nextResendAt = Date.now() + resendIntervalMs;
    }

    await new Promise((r) => setTimeout(r, statusPollIntervalMs));
  }
  return { status: "timeout" };
}

function isSafeDuplicateSendError(err: unknown): boolean {
  const msg = String(err ?? "").toLowerCase();
  return (
    msg.includes("already processed") ||
    msg.includes("already confirmed") ||
    msg.includes("transaction already in block") ||
    msg.includes("duplicate")
  );
}
