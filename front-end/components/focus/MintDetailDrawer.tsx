"use client";

import { cn, formatBps, formatMint, formatPercent, formatPrice, formatRelativeTime, formatTokenAmount, formatUsd, getScoreBg } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMintDetail } from "@/lib/hooks";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExternalLinkButton } from "@/components/ui/ExternalLinkButton";
import { getDexScreenerUrl, getSolscanTokenUrl, getSolscanTxUrl } from "@/lib/utils/links";
import { SectionFrame } from "@/components/ui/SectionFrame";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Badge } from "@/components/ui/Badge";
import { getExecutionResultBadge, getPositionStatusBadge, getSideBadge } from "@/lib/utils/badges";

interface MintDetailDrawerProps {
  mint: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MintDetailDrawer({ mint, open, onOpenChange }: MintDetailDrawerProps) {
  const { data, isLoading, isError, refetch } = useMintDetail(mint);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto border-l border-[rgba(142,152,169,0.12)] bg-[#0B0D10] sm:max-w-lg">
        <SheetHeader className="border-b border-[rgba(142,152,169,0.12)] pb-4">
          <SheetTitle className="text-lg font-semibold text-[#F2F5FA]">
            Mint Detail
          </SheetTitle>
        </SheetHeader>

        <div className="py-4">
          {isLoading && <LoadingState message="Loading mint details..." />}
          {isError && <ErrorState title="Failed to load mint details" onRetry={refetch} />}

          {data && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium text-[#F2F5FA]">
                    {formatMint(data.mint, 8)}
                  </span>
                  <CopyButton text={data.mint} />
                </div>
                <div className="flex gap-1">
                  <ExternalLinkButton href={getSolscanTokenUrl(data.mint)} label="Solscan" />
                  <ExternalLinkButton href={getDexScreenerUrl(data.mint)} label="Dex" />
                </div>
              </div>

              {data.riskReport && (
                <>
                  <SectionFrame title="Scores">
                    <div className="grid grid-cols-3 gap-4 p-4">
                      <Score label="Risk" value={data.riskReport.riskScore} />
                      <Score label="Opportunity" value={data.riskReport.opportunityScore} />
                      <Score label="Trade" value={data.riskReport.tradeScore} />
                    </div>
                  </SectionFrame>

                  <SectionFrame title="Risk Metrics">
                    <div className="p-4">
                      <KeyValueList
                        columns={2}
                        items={[
                          { key: "liquidity", label: "Liquidity", value: formatUsd(data.riskReport.liquidityUsd, { compact: true }), mono: true },
                          { key: "volume", label: "24h Volume", value: formatUsd(data.riskReport.volumeH24Usd, { compact: true }), mono: true },
                          { key: "marketAge", label: "Market Age", value: data.riskReport.marketAgeMinutes !== undefined ? `${Math.floor(data.riskReport.marketAgeMinutes / 60)}h ${data.riskReport.marketAgeMinutes % 60}m` : "--", mono: true },
                          { key: "priceImpact", label: "Price Impact", value: data.riskReport.priceImpactPct !== undefined ? formatPercent(data.riskReport.priceImpactPct / 100) : "--", mono: true },
                          { key: "top1", label: "Top 1 Holder", value: data.riskReport.top1HolderPct !== undefined ? formatPercent(data.riskReport.top1HolderPct / 100) : "--", mono: true },
                          { key: "top10", label: "Top 10 Holders", value: data.riskReport.top10HolderPct !== undefined ? formatPercent(data.riskReport.top10HolderPct / 100) : "--", mono: true },
                          { key: "loss", label: "Round-trip Loss", value: data.riskReport.impliedRoundTripLossBps !== undefined ? formatBps(data.riskReport.impliedRoundTripLossBps) : "--", mono: true },
                          { key: "route", label: "Can Exit", value: data.riskReport.canExitRoute ? "Yes" : "No", mono: true },
                        ]}
                      />
                    </div>
                  </SectionFrame>

                  {data.riskReport.flags.length > 0 && (
                    <SectionFrame title="Risk Flags">
                      <div className="flex flex-wrap gap-1 p-4">
                        {data.riskReport.flags.map((flag) => (
                          <span
                            key={flag}
                            className={cn(
                              "inline-flex rounded px-2 py-1 text-xs font-medium",
                              flag.includes("EXIT") || flag.includes("DRAIN") || flag.includes("FAIL")
                                ? "bg-[#F24E4E]/15 text-[#F24E4E]"
                                : "bg-[#F6B046]/15 text-[#F6B046]"
                            )}
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                    </SectionFrame>
                  )}
                </>
              )}

              {data.position && (
                <SectionFrame title="Position">
                  <div className="space-y-3 p-4">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const badge = getPositionStatusBadge(data.position!.status);
                        return (
                          <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", badge.bg, badge.text)}>
                            {badge.label}
                          </span>
                        );
                      })()}
                      {data.position.mode && (
                        <Badge variant={data.position.mode === "live" ? "danger" : "info"}>
                          {data.position.mode.toUpperCase()}
                        </Badge>
                      )}
                    </div>
                    <KeyValueList
                      columns={2}
                      items={[
                        { key: "opened", label: "Opened", value: formatRelativeTime(data.position.openedAtMs) },
                        { key: "closed", label: "Closed", value: data.position.closedAtMs ? formatRelativeTime(data.position.closedAtMs) : "--" },
                        { key: "entryPrice", label: "Entry Price", value: formatPrice(data.position.entryPriceUsd), mono: true },
                        { key: "exitPrice", label: "Exit Price", value: formatPrice(data.position.exitPriceUsd), mono: true },
                        { key: "entryToken", label: "Entry Tokens", value: formatTokenAmount(data.position.entryTokenAmount, 4), mono: true },
                        { key: "currentToken", label: "Current Tokens", value: formatTokenAmount(data.position.currentTokenAmount, 4), mono: true },
                        { key: "pnl", label: "PnL", value: formatUsd(data.position.pnlUsd, { showSign: true }), mono: true },
                        { key: "stage", label: "Stage", value: data.position.stage ?? "--" },
                      ]}
                    />
                    <div className="flex flex-wrap gap-2">
                      {data.position.entryTx && <ExternalLinkButton href={getSolscanTxUrl(data.position.entryTx)} label="Entry Tx" />}
                      {data.position.exitTx && <ExternalLinkButton href={getSolscanTxUrl(data.position.exitTx)} label="Exit Tx" />}
                    </div>
                  </div>
                </SectionFrame>
              )}

              {data.execution && (
                <SectionFrame title="Latest Execution">
                  <div className="space-y-3 p-4">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const sideBadge = getSideBadge(data.execution!.side);
                        return (
                          <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", sideBadge.bg, sideBadge.text)}>
                            {sideBadge.label}
                          </span>
                        );
                      })()}
                      {(() => {
                        const resultBadge = getExecutionResultBadge(data.execution!.ok, data.execution!.err);
                        return (
                          <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-medium uppercase", resultBadge.bg, resultBadge.text)}>
                            {resultBadge.label}
                          </span>
                        );
                      })()}
                    </div>
                    <KeyValueList
                      columns={2}
                      items={[
                        { key: "requested", label: "Requested", value: formatRelativeTime(data.execution.requestedAtMs) },
                        { key: "executed", label: "Executed", value: data.execution.executedAtMs ? formatRelativeTime(data.execution.executedAtMs) : "--" },
                        { key: "router", label: "Router", value: data.execution.routerPath ?? "--", mono: true },
                        { key: "inAmount", label: "In Amount", value: formatTokenAmount(data.execution.inAmount, 4), mono: true },
                        { key: "outAmount", label: "Out Amount", value: formatTokenAmount(data.execution.outAmount, 4), mono: true },
                        { key: "error", label: "Error", value: data.execution.err ?? "--" },
                      ]}
                    />
                    {data.execution.txSig && (
                      <ExternalLinkButton href={getSolscanTxUrl(data.execution.txSig)} label="Execution Tx" />
                    )}
                  </div>
                </SectionFrame>
              )}

              {(data.block || data.sell429 || data.snapshot) && (
                <SectionFrame title="Operational State">
                  <div className="space-y-3 p-4">
                    {data.block && (
                      <div className="rounded-lg border border-[#F24E4E]/30 bg-[#F24E4E]/5 p-3 text-xs text-[#F24E4E]">
                        Blocked for `{data.block.reason}` until {formatRelativeTime(data.block.expiresAtMs)}
                      </div>
                    )}
                    {data.sell429 && (
                      <div className="rounded-lg border border-[#F6B046]/30 bg-[#F6B046]/5 p-3 text-xs text-[#F6B046]">
                        Sell cooldown streak {data.sell429.streak}, clears {formatRelativeTime(data.sell429.cooldownUntilMs)}
                      </div>
                    )}
                    {data.snapshot && (
                      <KeyValueList
                        columns={2}
                        items={[
                          { key: "snapshotAt", label: "Snapshot", value: formatRelativeTime(data.snapshot.capturedAtMs) },
                          { key: "priceUsd", label: "Snapshot Price", value: formatPrice(data.snapshot.priceUsd), mono: true },
                          { key: "liqUsd", label: "Snapshot Liquidity", value: formatUsd(data.snapshot.liquidityUsd, { compact: true }), mono: true },
                        ]}
                      />
                    )}
                  </div>
                </SectionFrame>
              )}

              {data.riskReport && (
                <SectionFrame title="Raw Metrics">
                  <pre className="overflow-x-auto p-4 text-xs text-[#8B93A7]">
                    {JSON.stringify(data.riskReport.metrics, null, 2)}
                  </pre>
                </SectionFrame>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className={cn("inline-flex rounded px-3 py-1 text-lg font-bold", getScoreBg(value))}>
        {value}
      </div>
      <div className="mt-1 text-xs text-[#8B93A7]">{label}</div>
    </div>
  );
}
