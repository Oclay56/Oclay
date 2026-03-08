import type { SolanaRpc } from "../providers/solanaRpc";

export interface DevWallet {
  wallet: string;
  role: "mintAuthority" | "freezeAuthority" | "creatorPayer";
  confidence: number;
}

export interface DevClusterResult {
  devWallets: DevWallet[];
  creatorWallet?: string;
}

export async function analyzeDevCluster(params: {
  rpc: SolanaRpc;
  mint: string;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  maxPages?: number;
  pageSize?: number;
}): Promise<DevClusterResult> {
  const devWallets: DevWallet[] = [];
  if (params.mintAuthority) devWallets.push({ wallet: params.mintAuthority, role: "mintAuthority", confidence: 0.9 });
  if (params.freezeAuthority) devWallets.push({ wallet: params.freezeAuthority, role: "freezeAuthority", confidence: 0.9 });

  const maxPages = params.maxPages ?? 3;
  const pageSize = params.pageSize ?? 250;

  let before: string | undefined;
  let lastPage: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    let sigs: any[] = [];
    try {
      sigs = await params.rpc.getSignaturesForAddress(params.mint, { before, limit: pageSize });
    } catch (err) {
      if (String(err).includes("429")) break;
      throw err;
    }
    if (sigs.length === 0) break;
    lastPage = sigs;
    before = sigs[sigs.length - 1]?.signature;
    if (sigs.length < pageSize) break;
  }

  const oldestSig = lastPage.length > 0 ? lastPage[lastPage.length - 1]?.signature : undefined;
  if (!oldestSig) return { devWallets };

  const tx = await params.rpc.getTransaction(oldestSig, { maxSupportedTransactionVersion: 0 });
  if (!tx) return { devWallets };

  const message: any = (tx as any).transaction?.message;
  const feePayerPk =
    message?.staticAccountKeys?.[0] ??
    message?.accountKeys?.[0] ??
    undefined;
  const feePayer = feePayerPk?.toBase58 ? feePayerPk.toBase58() : feePayerPk ? String(feePayerPk) : undefined;
  if (!feePayer) return { devWallets };

  devWallets.push({ wallet: feePayer, role: "creatorPayer", confidence: 0.6 });
  return { devWallets, creatorWallet: feePayer };
}
