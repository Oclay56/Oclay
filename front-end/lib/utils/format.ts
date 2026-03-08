import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(
  value: number | string | undefined,
  options: {
    decimals?: number;
    compact?: boolean;
    prefix?: string;
    suffix?: string;
  } = {}
): string {
  const { decimals = 2, compact = false, prefix = "", suffix = "" } = options;
  if (value === undefined || value === null) return "--";

  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(num)) return "--";

  if (compact && Math.abs(num) >= 1_000_000) {
    return `${prefix}${(num / 1_000_000).toFixed(decimals)}M${suffix}`;
  }
  if (compact && Math.abs(num) >= 1_000) {
    return `${prefix}${(num / 1_000).toFixed(decimals)}K${suffix}`;
  }

  return `${prefix}${num.toFixed(decimals)}${suffix}`;
}

export function formatUsd(
  value: number | string | undefined,
  options: { compact?: boolean; showSign?: boolean } = {}
): string {
  const { compact = false, showSign = false } = options;
  if (value === undefined || value === null) return "--";

  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(num)) return "--";

  const sign = showSign && num > 0 ? "+" : "";
  return `${sign}${formatNumber(num, { decimals: 2, compact, prefix: "$" })}`;
}

export function formatTokenAmount(value: string | number | undefined, decimals: number = 6): string {
  if (value === undefined || value === null) return "--";

  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(num)) return "--";
  if (num === 0) return "0";
  if (Math.abs(num) < 0.000001) return num.toExponential(2);

  return num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatPrice(
  value: number | string | undefined,
  options: { decimals?: number } = {}
): string {
  const { decimals = 8 } = options;
  if (value === undefined || value === null) return "--";

  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(num)) return "--";
  if (num === 0) return "$0";
  if (num < 0.00001) return `$${num.toExponential(4)}`;
  return `$${num.toFixed(decimals)}`;
}

export function formatPercent(
  value: number | string | undefined,
  options: { decimals?: number; showSign?: boolean } = {}
): string {
  const { decimals = 1, showSign = false } = options;
  if (value === undefined || value === null) return "--";

  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(num)) return "--";

  const sign = showSign && num > 0 ? "+" : "";
  return `${sign}${(num * 100).toFixed(decimals)}%`;
}

export function formatBps(value: number | string | undefined): string {
  if (value === undefined || value === null) return "--";

  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(num)) return "--";
  return `${num.toFixed(0)} bps`;
}

export function truncate(str: string, startChars: number = 8, endChars?: number): string {
  if (!str) return "";
  const end = endChars ?? startChars;
  if (str.length <= startChars + end + 3) return str;
  return `${str.slice(0, startChars)}...${str.slice(-end)}`;
}

export function formatMint(mint: string | undefined, chars?: number): string {
  if (!mint) return "--";
  return truncate(mint, chars ?? 6, chars ?? 6);
}

export function getPnlColor(value: number | string | undefined): string {
  if (value === undefined || value === null) return "text-[#A7AFBF]";

  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(num)) return "text-[#A7AFBF]";
  if (num > 0) return "text-[#27C587]";
  if (num < 0) return "text-[#F24E4E]";
  return "text-[#A7AFBF]";
}

export function getScoreColor(score: number): string {
  if (score >= 70) return "text-[#27C587]";
  if (score >= 40) return "text-[#F6B046]";
  return "text-[#F24E4E]";
}

export function getScoreBg(score: number): string {
  if (score >= 70) return "bg-[#27C587]/15 text-[#27C587]";
  if (score >= 40) return "bg-[#F6B046]/15 text-[#F6B046]";
  return "bg-[#F24E4E]/15 text-[#F24E4E]";
}
