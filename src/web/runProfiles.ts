export interface RunProfile {
  id: string;
  label: string;
  configPath: string;
  strategyStyle: string;
  minBankrollUsd: number;
  maxBankrollUsd?: number;
  summary: string;
}

export const RUN_PROFILES: RunProfile[] = [
  {
    id: "micro_5",
    label: "Micro 5",
    configPath: "config/live-5.json",
    strategyStyle: "Micro Defensive",
    minBankrollUsd: 0,
    maxBankrollUsd: 8,
    summary: "Very small notional and strict guards for bankrolls around $5."
  },
  {
    id: "tiny_10_15",
    label: "Tiny 10-15",
    configPath: "config/tiny-bankroll.json",
    strategyStyle: "Tiny Defensive",
    minBankrollUsd: 8,
    maxBankrollUsd: 16,
    summary: "Single-position posture with stronger quality filters."
  },
  {
    id: "small_20",
    label: "Small 20",
    configPath: "config/low-bankroll.json",
    strategyStyle: "Low-Bankroll Balanced",
    minBankrollUsd: 16,
    maxBankrollUsd: 30,
    summary: "Low bankroll profile with moderate speed and constrained risk."
  },
  {
    id: "strict_40",
    label: "Strict 40",
    configPath: "config/live-40.json",
    strategyStyle: "Strict Live",
    minBankrollUsd: 30,
    maxBankrollUsd: 55,
    summary: "Conservative live profile with tighter slippage/risk controls."
  },
  {
    id: "growth_60_plus",
    label: "Growth 60+",
    configPath: "config/growth.json",
    strategyStyle: "Growth Capture",
    minBankrollUsd: 55,
    summary: "Higher upside profile for larger bankrolls."
  }
];

export const BANKROLL_PRESETS_USD = [5, 20, 35, 50];

export function recommendProfileForBankroll(bankrollUsd: number): RunProfile {
  const normalized = Number.isFinite(bankrollUsd) ? Math.max(0, bankrollUsd) : 0;
  const match = RUN_PROFILES.find((profile) => {
    if (normalized < profile.minBankrollUsd) return false;
    if (profile.maxBankrollUsd !== undefined && normalized > profile.maxBankrollUsd) return false;
    return true;
  });
  return match ?? RUN_PROFILES[RUN_PROFILES.length - 1];
}

export function resolveProfileById(profileId: string | undefined): RunProfile | undefined {
  if (!profileId) return undefined;
  const key = profileId.trim();
  if (!key) return undefined;
  return RUN_PROFILES.find((profile) => profile.id === key);
}

export function resolveProfileByConfigPath(configPath: string | undefined): RunProfile | undefined {
  if (!configPath) return undefined;
  const key = configPath.trim().toLowerCase();
  if (!key) return undefined;
  return RUN_PROFILES.find((profile) => profile.configPath.toLowerCase() === key);
}
