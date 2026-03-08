import type { DashboardRenderOptions, DashboardSnapshot } from "./types";

export function renderDashboard(snapshot: DashboardSnapshot, opts: DashboardRenderOptions = {}): string {
  const width = clamp(opts.width ?? 110, 72, 170);
  const lines: string[] = [];

  lines.push(sectionLine("=", width));
  lines.push(
    clip(
      `Oclay ${snapshot.meta.mode.toUpperCase()} Dashboard | uptime ${formatUptime(snapshot.meta.uptimeSec)} | refresh ${snapshot.meta.refreshSec}s | ${formatTime(snapshot.meta.nowMs)}`,
      width
    )
  );
  lines.push(clip(`DB: ${snapshot.meta.dbPath}`, width));
  if (opts.warning) lines.push(clip(`WARNING: ${opts.warning}`, width));
  lines.push(sectionLine("-", width));

  lines.push("Overview");
  lines.push(kv("tokens", String(snapshot.counts.tokens), width));
  lines.push(kv("snapshots", String(snapshot.counts.tokenSnapshots), width));
  lines.push(kv("risk_reports", String(snapshot.counts.riskReports), width));
  lines.push(kv("open_positions", String(snapshot.counts.openPositions), width));
  lines.push(kv("closed_positions", String(snapshot.counts.closedPositions), width));
  lines.push(kv("executions", String(snapshot.counts.executions), width));
  lines.push(kv("failed_executions", String(snapshot.counts.failedExecutions), width));
  lines.push(kv("active_blocks", String(snapshot.counts.activeBlocks), width));
  lines.push(kv("reports_last_1m", String(snapshot.activity.reportsLast1m), width));
  lines.push(kv("executions_last_5m", String(snapshot.activity.executionsLast5m), width));
  lines.push(kv("stale_risk_data", snapshot.health.staleRiskData ? "YES" : "NO", width));
  if (snapshot.latency) {
    lines.push(
      kv(
        "detect_to_intent",
        `n=${snapshot.latency.detectToIntentSamples} p50=${fmtMs(snapshot.latency.detectToIntentMs.p50)} p95=${fmtMs(snapshot.latency.detectToIntentMs.p95)}`,
        width
      )
    );
    lines.push(
      kv(
        "sent_to_confirmed",
        `n=${snapshot.latency.sentToConfirmedSamples} p50=${fmtMs(snapshot.latency.sentToConfirmedMs.p50)} p95=${fmtMs(snapshot.latency.sentToConfirmedMs.p95)}`,
        width
      )
    );
  }
  lines.push(sectionLine("-", width));

  lines.push("Capital");
  lines.push(kv("wallet_sol_balance", fmtSol(snapshot.capital.walletSolBalance), width));
  lines.push(kv("wallet_usd_balance", fmtUsd(snapshot.capital.walletUsdBalance), width));
  lines.push(
    kv(
      "wallet_balance_age",
      snapshot.capital.walletBalanceAtMs ? formatAge(snapshot.meta.nowMs - snapshot.capital.walletBalanceAtMs) : "n/a",
      width
    )
  );
  lines.push(kv("realized_pnl_usd", fmtUsd(snapshot.capital.realizedPnlUsd), width));
  lines.push(kv("unrealized_pnl_usd", fmtUsd(snapshot.capital.unrealizedPnlUsd), width));
  lines.push(kv("daily_drawdown_usd", fmtUsd(snapshot.capital.dailyDrawdownUsd), width));
  lines.push(kv("deployed_usd", fmtUsd(snapshot.capital.deployedUsd), width));
  lines.push(kv("pending_reserved_usd", fmtUsd(snapshot.capital.pendingReservedEntryUsd), width));
  lines.push(
    kv(
      "base_asset_usd",
      snapshot.capital.baseAssetUsdPrice !== undefined
        ? `${snapshot.capital.baseAssetUsdPrice.toFixed(4)} (${formatAge(snapshot.meta.nowMs - (snapshot.capital.baseAssetUsdPriceAtMs ?? snapshot.meta.nowMs))} old)`
        : "n/a",
      width
    )
  );
  lines.push(sectionLine("-", width));

  lines.push("Stream Health");
  lines.push(kv("enabled", snapshot.streamHealth.enabled ? "YES" : "NO", width));
  lines.push(kv("connected", snapshot.streamHealth.connected ? "YES" : "NO", width));
  lines.push(kv("stale", snapshot.streamHealth.stale ? "YES" : "NO", width));
  lines.push(kv("fallback_active", snapshot.streamHealth.fallbackActive ? "YES" : "NO", width));
  lines.push(
    kv(
      "last_event_age",
      snapshot.streamHealth.lastEventAtMs ? formatAge(snapshot.meta.nowMs - snapshot.streamHealth.lastEventAtMs) : "n/a",
      width
    )
  );
  lines.push(sectionLine("-", width));

  lines.push("Sell 429 Breaker");
  lines.push(kv("global_active", snapshot.sell429.globalActive ? "YES" : "NO", width));
  lines.push(
    kv(
      "global_retry_in",
      snapshot.sell429.globalCooldownUntilMs ? formatAge(snapshot.sell429.globalCooldownUntilMs - snapshot.meta.nowMs) : "n/a",
      width
    )
  );
  if (snapshot.sell429.perMint.length === 0) {
    lines.push("none");
  } else {
    lines.push(clip("mint              streak  retry_in", width));
    for (const row of snapshot.sell429.perMint) {
      lines.push(
        clip(
          `${padRight(shortMint(row.mint), 14)}  ${padLeft(String(row.streak), 6)}  ${padLeft(formatAge(row.cooldownUntilMs - snapshot.meta.nowMs), 8)}`,
          width
        )
      );
    }
  }
  lines.push(sectionLine("-", width));

  lines.push("Alerts (Critical)");
  if (snapshot.alerts.length === 0) {
    lines.push("none");
  } else {
    lines.push(clip("time       sev       code                  mint              cnt  retry_in  summary", width));
    for (const a of snapshot.alerts) {
      lines.push(
        clip(
          `${formatTime(a.lastSeenAtMs)}  ${padRight(a.severity, 8)}  ${padRight(a.code, 20)}  ${padRight(shortMint(a.mint), 14)}  ${padLeft(String(a.count), 3)}  ${padLeft(a.retryAtMs ? formatAge(a.retryAtMs - snapshot.meta.nowMs) : "-", 8)}  ${clip(a.summary, Math.max(8, width - 84))}`,
          width
        )
      );
    }
  }
  lines.push(sectionLine("-", width));

  lines.push("Focused Coin");
  if (!snapshot.focus) {
    lines.push("none");
  } else {
    lines.push(kv("mint", snapshot.focus.mint, width));
    lines.push(kv("reason", snapshot.focus.reason, width));
    if (snapshot.focus.risk) {
      lines.push(kv("risk_score", snapshot.focus.risk.riskScore.toFixed(1), width));
      lines.push(kv("trade_score", snapshot.focus.risk.tradeScore.toFixed(1), width));
      lines.push(kv("flags", snapshot.focus.risk.flags.slice(0, 4).join(",") || "-", width));
    } else {
      lines.push(kv("risk", "n/a", width));
    }
    if (snapshot.focus.position) {
      lines.push(kv("position_status", snapshot.focus.position.status, width));
      lines.push(kv("position_base_in", formatAmount(snapshot.focus.position.entryBaseAmount), width));
      lines.push(kv("position_token_in", formatAmount(snapshot.focus.position.entryTokenAmount), width));
    } else {
      lines.push(kv("position", "none", width));
    }
    if (snapshot.focus.execution) {
      lines.push(kv("last_exec_side", snapshot.focus.execution.side, width));
      lines.push(kv("last_exec_ok", snapshot.focus.execution.ok ? "YES" : "NO", width));
      lines.push(kv("last_exec_path", snapshot.focus.execution.routerPath ?? "-", width));
      lines.push(kv("last_exec_err", snapshot.focus.execution.err ?? "-", width));
    } else {
      lines.push(kv("last_exec", "none", width));
    }
    if (snapshot.focus.block) {
      lines.push(kv("block_reason", snapshot.focus.block.reason, width));
      lines.push(kv("block_expires_in", formatAge(snapshot.focus.block.expiresAtMs - snapshot.meta.nowMs), width));
    }
    if (snapshot.focus.sell429) {
      lines.push(kv("sell429_streak", String(snapshot.focus.sell429.streak), width));
      lines.push(
        kv("sell429_retry_in", formatAge(snapshot.focus.sell429.cooldownUntilMs - snapshot.meta.nowMs), width)
      );
    }
  }
  lines.push(sectionLine("-", width));

  lines.push("Recent Risk Reports");
  if (snapshot.recentReports.length === 0) {
    lines.push("none");
  } else {
    lines.push(clip("time       mint              risk   trade   flags", width));
    for (const r of snapshot.recentReports) {
      lines.push(
        clip(
          `${formatTime(r.createdAtMs)}  ${padRight(shortMint(r.mint), 14)}  ${padLeft(r.riskScore.toFixed(1), 5)}  ${padLeft(r.tradeScore.toFixed(1), 7)}  ${clip(r.flags.slice(0, 3).join(",") || "-", Math.max(8, width - 52))}`,
          width
        )
      );
    }
  }
  lines.push(sectionLine("-", width));

  lines.push("Open Positions");
  if (snapshot.openPositions.length === 0) {
    lines.push("none");
  } else {
    lines.push(clip("opened     mint              status   base_in      token_in     entry/max_usd", width));
    for (const p of snapshot.openPositions) {
      lines.push(
        clip(
          `${formatTime(p.openedAtMs)}  ${padRight(shortMint(p.mint), 14)}  ${padRight(p.status, 7)}  ${padLeft(formatAmount(p.entryBaseAmount), 10)}  ${padLeft(formatAmount(p.entryTokenAmount), 11)}  ${formatPairPrice(p.entryPriceUsd, p.maxSeenPriceUsd)}`,
          width
        )
      );
    }
  }
  lines.push(sectionLine("-", width));

  lines.push("Recent Executions");
  if (snapshot.recentExecutions.length === 0) {
    lines.push("none");
  } else {
    lines.push(clip("time       side  mint              ok  path              in          out         err", width));
    for (const e of snapshot.recentExecutions) {
      lines.push(
        clip(
          `${formatTime(e.requestedAtMs)}  ${padRight(e.side, 4)}  ${padRight(shortMint(e.mint), 14)}  ${e.ok ? "Y " : "N "}  ${padRight(e.routerPath ?? "-", 16)}  ${padLeft(formatAmount(e.inAmount), 10)}  ${padLeft(formatAmount(e.outAmount), 10)}  ${clip(e.err ?? "-", Math.max(8, width - 92))}`,
          width
        )
      );
    }
  }
  lines.push(sectionLine("-", width));

  lines.push("Mint Rollups");
  if (snapshot.mintRollups.length === 0) {
    lines.push("none");
  } else {
    lines.push(clip("mint              pos   last_action       w/l   fail_sell_5m  route_ok", width));
    for (const r of snapshot.mintRollups) {
      const lastAction = r.lastActionSide && r.lastActionAtMs ? `${r.lastActionSide}@${formatTime(r.lastActionAtMs)}` : "-";
      lines.push(
        clip(
          `${padRight(shortMint(r.mint), 14)}  ${padRight(r.hasActivePosition ? (r.activePositionStatus ?? "Y") : "-", 5)}  ${padRight(lastAction, 16)}  ${padLeft(`${r.wins24h}/${r.losses24h}`, 5)}  ${padLeft(String(r.failedSells5m), 12)}  ${r.routeOk ? "YES" : "NO"}`,
          width
        )
      );
    }
  }
  lines.push(sectionLine("-", width));

  lines.push("Active Blocks");
  if (snapshot.activeBlocks.length === 0) {
    lines.push("none");
  } else {
    lines.push(clip("mint              expires_in  reason", width));
    for (const b of snapshot.activeBlocks) {
      lines.push(
        clip(
          `${padRight(shortMint(b.mint), 14)}  ${padLeft(formatAge(b.expiresAtMs - snapshot.meta.nowMs), 10)}  ${clip(b.reason, Math.max(8, width - 30))}`,
          width
        )
      );
    }
  }
  lines.push(sectionLine("=", width));

  return lines.join("\n");
}

export function renderCompactSummary(snapshot: DashboardSnapshot, warning?: string): string {
  const lastMint = snapshot.recentReports[0]?.mint ? shortMint(snapshot.recentReports[0].mint) : "-";
  const base = `[${formatTime(snapshot.meta.nowMs)}] mode=${snapshot.meta.mode} up=${formatUptime(snapshot.meta.uptimeSec)} tokens=${snapshot.counts.tokens} reports=${snapshot.counts.riskReports} open=${snapshot.counts.openPositions} exec=${snapshot.counts.executions} fail=${snapshot.counts.failedExecutions} alerts=${snapshot.alerts.length} last=${lastMint}`;
  if (!warning) return base;
  return `${base} warning=${clip(warning, 80)}`;
}

function shortMint(v: string): string {
  if (v.length <= 14) return v;
  return `${v.slice(0, 6)}...${v.slice(-4)}`;
}

function sectionLine(char: string, width: number): string {
  return char.repeat(clamp(width, 20, 220));
}

function kv(label: string, value: string, width: number): string {
  return clip(`${padRight(`${label}:`, 22)} ${value}`, width);
}

function padLeft(v: string, n: number): string {
  return v.length >= n ? v : `${" ".repeat(n - v.length)}${v}`;
}

function padRight(v: string, n: number): string {
  return v.length >= n ? v : `${v}${" ".repeat(n - v.length)}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().slice(11, 19);
}

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function formatAge(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

function formatPairPrice(a?: number, b?: number): string {
  const p1 = a === undefined || !Number.isFinite(a) ? "-" : a.toFixed(6);
  const p2 = b === undefined || !Number.isFinite(b) ? "-" : b.toFixed(6);
  return `${p1}/${p2}`;
}

function formatAmount(v?: string | number): string {
  if (v === undefined) return "-";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "-";
    return compactNumber(v);
  }
  const s = String(v).trim();
  if (!s) return "-";
  if (/^-?\d+(\.\d+)?$/.test(s) && s.includes(".")) {
    const n = Number(s);
    if (Number.isFinite(n)) return compactNumber(n);
  }
  if (/^-?\d+$/.test(s)) return compactIntString(s);
  return clip(s, 10);
}

function compactIntString(input: string): string {
  const neg = input.startsWith("-");
  const digits = (neg ? input.slice(1) : input).replace(/^0+/, "") || "0";
  const sign = neg ? "-" : "";
  const units: Array<{ unit: string; exp: number }> = [
    { unit: "T", exp: 12 },
    { unit: "B", exp: 9 },
    { unit: "M", exp: 6 },
    { unit: "K", exp: 3 }
  ];
  for (const u of units) {
    if (digits.length > u.exp) {
      const wholeLen = digits.length - u.exp;
      const whole = digits.slice(0, wholeLen);
      const frac = digits.slice(wholeLen, wholeLen + 1);
      return `${sign}${whole}${frac && frac !== "0" ? `.${frac}` : ""}${u.unit}`;
    }
  }
  return `${sign}${digits}`;
}

function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (abs >= 1) return n.toFixed(2);
  return n.toPrecision(2);
}

function fmtMs(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "-";
  return `${Math.round(v)}ms`;
}

function fmtUsd(v?: number): string {
  if (v === undefined || !Number.isFinite(v)) return "n/a";
  return `$${v.toFixed(2)}`;
}

function fmtSol(v?: number): string {
  if (v === undefined || !Number.isFinite(v)) return "n/a";
  return `${v.toFixed(6)} SOL`;
}

function clip(v: string, width: number): string {
  if (v.length <= width) return v;
  if (width <= 3) return v.slice(0, width);
  return `${v.slice(0, width - 3)}...`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
