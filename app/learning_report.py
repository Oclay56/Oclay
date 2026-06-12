"""Human-readable renderings of the backtest reports for a full console window.

The TUI's inline panel is small; these print the same data as clean, sectioned
rich output so a launched console window is easy to read at full size.
"""

from __future__ import annotations

from typing import Any

from rich.console import Console
from rich.table import Table


def _pct(value: Any) -> str:
    try:
        return f"{float(value) * 100:.1f}%"
    except (TypeError, ValueError):
        return "—"


def _num(value: Any) -> str:
    return "—" if value is None else str(value)


def print_profitability_report(report: dict[str, Any], *, console: Console | None = None) -> None:
    console = console or Console()
    console.rule("[bold green]PROFITABLE  -  Realized Performance")

    sample = report.get("sampleSize", {})
    console.print(
        f"Settled legs: [bold]{_num(sample.get('settledPicks'))}[/]   "
        f"Decided slips: [bold]{_num(sample.get('decidedSlips'))}[/]\n"
    )

    leg = report.get("legPerformance", {})
    if leg.get("gradedLegs"):
        console.print(
            f"[bold]Leg hit rate:[/] {_pct(leg.get('overallHitRate'))} "
            f"over {leg.get('gradedLegs')} graded legs\n"
        )
        table = Table(title="Hit rate by market", title_style="bold")
        table.add_column("Market")
        table.add_column("Legs", justify="right")
        table.add_column("Wins", justify="right")
        table.add_column("Hit rate", justify="right")
        for m in leg.get("byMarket", []):
            style = "dim" if not m.get("sufficientSample") else ""
            table.add_row(
                m["market"], str(m["legs"]), str(m.get("wins", "")), _pct(m["hitRate"]), style=style
            )
        console.print(table)
        cold = leg.get("coldMarkets") or []
        if cold:
            names = ", ".join(c["market"] for c in cold)
            console.print(f"\n[bold red]Cold markets (hit < 50% on real sample):[/] {names}")
    else:
        console.print("[yellow]No graded legs yet — log live slips and let them settle.[/]")

    slip = report.get("slipPerformance", {})
    if slip.get("decidedSlips"):
        roi = slip.get("roi")
        roi_color = "green" if (roi or 0) > 0 else "red"
        console.print(
            f"\n[bold]Slip win rate:[/] {_pct(slip.get('winRate'))}   "
            f"[bold]Realized ROI:[/] [{roi_color}]{_pct(roi)}[/] "
            f"over {slip.get('pricedSlips')} units\n"
        )
        by_legs = slip.get("byLegCount") or []
        if by_legs:
            table = Table(title="ROI by parlay size", title_style="bold")
            table.add_column("Legs", justify="right")
            table.add_column("Slips", justify="right")
            table.add_column("Win rate", justify="right")
            table.add_column("ROI", justify="right")
            for b in by_legs:
                r = b.get("roi")
                style = "green" if (r or 0) > 0 else "red"
                table.add_row(
                    str(b["legCount"]), str(b["slips"]), _pct(b["winRate"]),
                    f"[{style}]{_pct(r)}[/]",
                )
            console.print(table)

    console.print("\n[dim]Read-only report. Close this window whenever you're done.[/]")


def print_honesty_report(report: dict[str, Any], *, console: Console | None = None) -> None:
    console = console or Console()
    console.rule("[bold cyan]HONEST  -  Model Calibration")

    console.print(
        f"Scored [bold]{_num(report.get('scoredPicks'))}[/] of "
        f"{_num(report.get('consideredPicks'))} settled picks point-in-time.\n"
    )

    if report.get("status") != "ok":
        console.print("[yellow]Not enough scoreable history yet to judge calibration.[/]")
        _print_coverage(report, console)
        console.print("\n[dim]Close this window whenever you're done.[/]")
        return

    err = report.get("calibrationError")
    err_pct = (err or 0) * 100
    if err_pct <= 2:
        verdict = "[bold green]Excellent[/] — predictions match reality closely."
    elif err_pct <= 5:
        verdict = "[bold yellow]Decent[/] — minor drift between predicted and actual."
    else:
        verdict = "[bold red]Off[/] — the model is mis-stating probabilities; calibration will correct it over time."

    console.print(
        f"[bold]Predicted avg:[/] {_pct(report.get('meanPredicted'))}   "
        f"[bold]Actual hit rate:[/] {_pct(report.get('actualHitRate'))}\n"
        f"[bold]Calibration error:[/] {_pct(err)}   "
        f"[bold]Brier score:[/] {_num(report.get('brierScore'))}\n"
        f"{verdict}\n"
    )

    curve = report.get("reliabilityCurve") or []
    if curve:
        table = Table(title="Reliability curve (predicted vs actual)", title_style="bold")
        table.add_column("Predicted band")
        table.add_column("Picks", justify="right")
        table.add_column("Mean predicted", justify="right")
        table.add_column("Actual hit rate", justify="right")
        for row in curve:
            style = "dim" if row.get("picks", 0) < 10 else ""
            table.add_row(
                row["bucket"], str(row["picks"]),
                _pct(row["meanPredicted"]), _pct(row["actualHitRate"]),
                style=style,
            )
        console.print(table)
        console.print("[dim]Small-sample rows (<10 picks) are dimmed — trust the aggregate.[/]")

    _print_coverage(report, console)
    console.print("\n[dim]Read-only report. Close this window whenever you're done.[/]")


def _print_coverage(report: dict[str, Any], console: Console) -> None:
    gaps = report.get("coverageGaps") or {}
    if not gaps:
        return
    parts = []
    if gaps.get("insufficientPriorGames"):
        parts.append(f"{gaps['insufficientPriorGames']} skipped (too few pre-game games)")
    if gaps.get("unresolvedPlayer"):
        parts.append(f"{gaps['unresolvedPlayer']} unresolved players")
    if gaps.get("unmappableMarket"):
        parts.append(f"{gaps['unmappableMarket']} unmappable markets")
    if parts:
        console.print("\n[dim]Coverage gaps: " + "; ".join(parts) + ".[/]")
