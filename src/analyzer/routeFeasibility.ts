import type { AppConfig } from "../config/schema";
import type { RiskFlag } from "../domain/flags";
import type { JupiterUltraClient } from "../providers/jupiterUltra";
import { parsePriceImpactPct } from "../providers/jupiterUltra";

export interface RouteFeasibilityResult {
  flags: RiskFlag[];
  canExitRoute: boolean;
  impliedRoundTripLossBps?: number;
  buyOutAmount?: bigint;
  sellOutAmount?: bigint;
  priceImpactPct?: number;
}

export async function analyzeRouteFeasibility(cfg: AppConfig, jup: JupiterUltraClient, mint: string): Promise<RouteFeasibilityResult> {
  const flags: RiskFlag[] = [];
  const baseMint = cfg.assets.baseAssetMint;

  let buy;
  try {
    buy = await jup.getOrder({
      inputMint: baseMint,
      outputMint: mint,
      amount: String(cfg.analysis.entryTestAmountLamports)
    });
  } catch {
    flags.push("NO_EXIT_ROUTE");
    return { flags, canExitRoute: false };
  }

  const buyOutAmount = BigInt(buy.outAmount);
  if (buyOutAmount <= 0n) {
    flags.push("NO_EXIT_ROUTE");
    return { flags, canExitRoute: false };
  }

  let sell;
  try {
    sell = await jup.getOrder({
      inputMint: mint,
      outputMint: baseMint,
      amount: buy.outAmount,
      slippageBps: cfg.analysis.exitTestSlippageBps
    });
  } catch {
    flags.push("NO_EXIT_ROUTE");
    return { flags, canExitRoute: false, buyOutAmount };
  }

  const sellOutAmount = BigInt(sell.outAmount);
  if (sellOutAmount <= 0n) {
    flags.push("NO_EXIT_ROUTE");
    return { flags, canExitRoute: false, buyOutAmount, sellOutAmount };
  }

  const baseIn = BigInt(cfg.analysis.entryTestAmountLamports);
  const lossBps =
    sellOutAmount >= baseIn ? 0 : Number(((baseIn - sellOutAmount) * 10_000n) / baseIn);

  if (lossBps > cfg.analysis.maxImpliedRoundTripLossBps) flags.push("IMPLIED_ROUNDTRIP_LOSS_HIGH");

  const impact = Math.max(
    Math.abs(parsePriceImpactPct(buy.priceImpactPct) ?? 0),
    Math.abs(parsePriceImpactPct(sell.priceImpactPct) ?? 0)
  );
  if (impact > 0.05) flags.push("HIGH_PRICE_IMPACT");

  return {
    flags,
    canExitRoute: true,
    impliedRoundTripLossBps: lossBps,
    buyOutAmount,
    sellOutAmount,
    priceImpactPct: impact
  };
}

