"use client";

import { cn } from "@/lib/utils";
import { formatNumber, formatUsd, getPnlColor } from "@/lib/utils/format";
import { CapitalState } from "@/lib/types";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { TrendingUp, TrendingDown, DollarSign, Wallet } from "lucide-react";

interface CapitalCardProps {
  capital: CapitalState;
  className?: string;
}

export function CapitalCard({ capital, className }: CapitalCardProps) {
  const walletSubValue =
    capital.walletBalanceAtMs === undefined
      ? undefined
      : capital.walletUsdBalance === undefined
        ? new Date(capital.walletBalanceAtMs).toLocaleTimeString()
        : `${formatUsd(capital.walletUsdBalance)} @ ${new Date(capital.walletBalanceAtMs).toLocaleTimeString()}`;

  const items = [
    {
      label: "Wallet SOL",
      value:
        capital.walletSolBalance === undefined
          ? "--"
          : `${formatNumber(capital.walletSolBalance, { decimals: 6 })} SOL`,
      subValue: walletSubValue,
      icon: Wallet,
      color: "text-[#2EC3E5]",
    },
    {
      label: "Pending Reserved",
      value: formatUsd(capital.pendingReservedEntryUsd),
      icon: Wallet,
      color: "text-[#F6B046]",
    },
    {
      label: "SOL Price",
      value: formatUsd(capital.baseAssetUsdPrice),
      subValue: capital.baseAssetUsdPriceAtMs
        ? new Date(capital.baseAssetUsdPriceAtMs).toLocaleTimeString()
        : undefined,
      icon: DollarSign,
      color: "text-[#2EC3E5]",
    },
    {
      label: "Realized PnL",
      value: formatUsd(capital.realizedPnlUsd, { showSign: true }),
      icon: capital.realizedPnlUsd === undefined || capital.realizedPnlUsd >= 0 ? TrendingUp : TrendingDown,
      color: getPnlColor(capital.realizedPnlUsd),
    },
    {
      label: "Unrealized PnL",
      value: formatUsd(capital.unrealizedPnlUsd, { showSign: true }),
      icon: capital.unrealizedPnlUsd === undefined || capital.unrealizedPnlUsd >= 0 ? TrendingUp : TrendingDown,
      color: getPnlColor(capital.unrealizedPnlUsd),
    },
    {
      label: "Deployed",
      value: formatUsd(capital.deployedUsd),
      icon: Wallet,
      color: "text-[#A7AFBF]",
    },
    {
      label: "Daily Drawdown",
      value: formatUsd(capital.dailyDrawdownUsd),
      icon: TrendingDown,
      color: "text-[#F24E4E]",
    },
  ];

  return (
    <SectionFrame title="Capital" className={className}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#8B93A7]">
                <Icon className="h-3 w-3" />
                {item.label}
              </div>
              <div className={cn("text-lg font-semibold font-mono", item.color)}>
                {item.value}
              </div>
              {item.subValue && (
                <div className="text-xs text-[#8B93A7]">{item.subValue}</div>
              )}
            </div>
          );
        })}
      </div>
    </SectionFrame>
  );
}
