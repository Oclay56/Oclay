import type { AppConfig } from "../config/schema";

export interface PaperBuyModelResult {
  tokenOut: bigint;
  entryBaseCost: bigint;
  adverseBpsApplied: number;
  networkFeeLamports: bigint;
}

export interface PaperSellModelResult {
  baseOut: bigint;
  adverseBpsApplied: number;
  networkFeeLamports: bigint;
}

export function modelPaperBuy(params: {
  cfg: AppConfig;
  quoteOutAmount: bigint;
  quoteInAmount: bigint;
  priceImpactPct?: number;
}): PaperBuyModelResult {
  const { cfg, quoteOutAmount, quoteInAmount, priceImpactPct } = params;
  const adverseBps = computeAdverseBps(cfg, "entry", priceImpactPct);
  const tokenOut = applyBpsHaircut(quoteOutAmount, adverseBps);
  const networkFeeLamports = BigInt(cfg.paper.fixedNetworkFeeLamportsPerSwap);
  return {
    tokenOut,
    entryBaseCost: quoteInAmount + networkFeeLamports,
    adverseBpsApplied: adverseBps,
    networkFeeLamports
  };
}

export function modelPaperSell(params: {
  cfg: AppConfig;
  quoteOutAmount: bigint;
  priceImpactPct?: number;
}): PaperSellModelResult {
  const { cfg, quoteOutAmount, priceImpactPct } = params;
  const adverseBps = computeAdverseBps(cfg, "exit", priceImpactPct);
  const grossOut = applyBpsHaircut(quoteOutAmount, adverseBps);
  const networkFeeLamports = BigInt(cfg.paper.fixedNetworkFeeLamportsPerSwap);
  const baseOut = grossOut > networkFeeLamports ? grossOut - networkFeeLamports : 0n;
  return { baseOut, adverseBpsApplied: adverseBps, networkFeeLamports };
}

function computeAdverseBps(cfg: AppConfig, side: "entry" | "exit", priceImpactPct?: number): number {
  const base = side === "entry" ? cfg.paper.adverseEntryBps : cfg.paper.adverseExitBps;
  if (cfg.paper.model === "light") return 0;
  if (cfg.paper.model === "conservative") return base;

  const scaled = Math.ceil(base * cfg.paper.highModelImpactMultiplier);
  const impact = priceImpactPct && Number.isFinite(priceImpactPct) ? Math.max(0, Math.ceil(priceImpactPct * 100)) : 0;
  return Math.min(10_000, scaled + impact);
}

function applyBpsHaircut(amount: bigint, bps: number): bigint {
  const clamped = Math.max(0, Math.min(10_000, Math.floor(bps)));
  if (clamped === 0) return amount;
  return (amount * BigInt(10_000 - clamped)) / 10_000n;
}
