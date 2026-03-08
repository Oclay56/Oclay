export const RISK_FLAGS = [
  "HAS_MINT_AUTH",
  "HAS_FREEZE_AUTH",
  "TOKEN2022_TRANSFER_HOOK",
  "NON_TRANSFERABLE",
  "DEFAULT_FROZEN",
  "HIGH_TRANSFER_FEE",
  "NO_EXIT_ROUTE",
  "SELL_SIM_FAIL",
  "IMPLIED_ROUNDTRIP_LOSS_HIGH",
  "TOP1_TOO_LARGE",
  "TOP10_TOO_CONCENTRATED",
  "HOLDERS_UNKNOWN",
  "LOW_LIQUIDITY",
  "LOW_VOLUME",
  "TOO_NEW",
  "HIGH_PRICE_IMPACT",
  "DEV_DUMPING",
  "DEV_WALLET_UNKNOWN",
  "SUPPLY_INCREASED",
  "LIQUIDITY_DRAIN",
  "EXIT_ROUTE_GONE",
  "PROBE_FAILED"
] as const;

export type RiskFlag = (typeof RISK_FLAGS)[number];

export function isRiskFlag(x: string): x is RiskFlag {
  return (RISK_FLAGS as readonly string[]).includes(x);
}
