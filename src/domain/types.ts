import type { RiskFlag } from "./flags";

export type PubkeyStr = string;
export type MintStr = string;

export type TradeMode = "paper" | "live";
export type IntentType = "BUY" | "SELL";
export type IntentKind =
  | "ENTRY_TEST"
  | "ENTRY_SCALE"
  | "EXIT_TP1"
  | "EXIT_TP2"
  | "EXIT_TP3"
  | "EXIT_STOP"
  | "EXIT_EMERGENCY"
  | "EXIT_TIME";
export type PositionStage = "TEST" | "SCALED" | "FULL";

export interface TokenCandidate {
  candidateId?: string;
  mint: MintStr;
  discoveredAtMs: number;
  source: string;
}

export interface DexPairSnapshot {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string; name: string };
  priceNative?: string;
  priceUsd?: string;
  liquidityUsd?: number;
  volume?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  txns?: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  priceChange?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  pairCreatedAt?: number; // unix ms
}

export interface TokenRiskReport {
  mint: MintStr;
  createdAtMs: number;
  flags: RiskFlag[];
  canExitRoute: boolean;
  impliedRoundTripLossBps?: number;
  top1HolderPct?: number;
  top10HolderPct?: number;
  liquidityUsd?: number;
  volumeH24Usd?: number;
  marketAgeMinutes?: number;
  priceImpactPct?: number;
  riskScore: number;
  opportunityScore: number;
  tradeScore: number;
  reasons: string[];
  metrics: Record<string, unknown>;
}

export interface TradeIntent {
  id: string;
  type: IntentType;
  intentKind: IntentKind;
  mode: TradeMode;
  mint: MintStr;
  baseMint: MintStr;
  notionalUsd: number;
  amountIn: bigint; // base units if BUY; token units if SELL (for live we compute actual token amount)
  slippageBps: number;
  createdAtMs: number;
  reason: string;
  candidateId?: string;
  positionId?: string;
  parentPositionId?: string;
}

export interface TradeExecutionResult {
  intentId: string;
  ok: boolean;
  signature?: string;
  err?: string;
  inAmount?: bigint;
  outAmount?: bigint;
  executedAtMs: number;
  raw?: unknown;
}

export type PositionStatus = "OPEN" | "CLOSED" | "ENTERING" | "EXITING";

export interface Position {
  id: string;
  mint: MintStr;
  mode: TradeMode;
  status: PositionStatus;
  stage: PositionStage;
  sniperMode: boolean;
  tpStep: number;
  openedAtMs: number;
  closedAtMs?: number;
  entryTx?: string;
  exitTx?: string;
  baseMint: MintStr;
  entryBaseAmount: bigint;
  entryTokenAmount: bigint;
  initialTokenAmount: bigint;
  currentTokenAmount: bigint;
  exitBaseAmount?: bigint;
  pnlUsd?: number;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  maxSeenPriceUsd?: number;
}
