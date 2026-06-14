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
        return "-"


def _num(value: Any) -> str:
    return "-" if value is None else str(value)


def _pending_line(item: dict[str, Any]) -> str:
    """One held-back pick as 'Player - market side line (date)'."""
    player = item.get("player") or "(unknown player)"
    market = item.get("market") or "?"
    side = str(item.get("side") or "").lower()
    line = item.get("line")
    bet = " ".join(part for part in (market, side, _num(line)) if part and part != "-")
    date = item.get("slateDate")
    tail = f"  [dim]{date}[/]" if date else ""
    return f"[bold]{player}[/] - {bet}{tail}"


def _print_pending_group(console: Console, items: list[dict[str, Any]], *, reason_style: str) -> None:
    """Print one pending bucket, split into your bet legs vs board captures."""
    slip = [i for i in items if i.get("source") == "slip"]
    board = [i for i in items if i.get("source") != "slip"]
    if slip:
        console.print("    [bold]Your slip legs:[/]")
        for item in slip:
            console.print(f"      - {_pending_line(item)}  [{reason_style}]({item.get('reason')})[/]")
    if board:
        console.print("    [dim]Board captures (not bets - tracked for calibration only):[/]")
        for item in board:
            console.print(f"      - [dim]{_pending_line(item)}[/]  [{reason_style}]({item.get('reason')})[/]")


def _print_pending_sections(console: Console, report: dict[str, Any]) -> None:
    """Shared 'Waiting on stats' / 'Needs attention' lists used by Trainer and
    Honest. Each bucket is split into your actual bet legs and whole-board
    calibration captures so the list never reads like you bet more than you did.
    Renders nothing when nothing is held back."""
    waiting = report.get("waitingOn") or []
    attention = report.get("needsAttention") or []
    if waiting:
        console.print(
            f"\n  [bold]Waiting on stats[/] ({len(waiting)}) "
            "[dim]- will settle on a later run once box scores post:[/]"
        )
        _print_pending_group(console, waiting, reason_style="dim")
    if attention:
        console.print(
            f"\n  [bold red]Needs attention[/] ({len(attention)}) "
            "[dim]- these will not settle on their own:[/]"
        )
        _print_pending_group(console, attention, reason_style="red")
    counts = report.get("pendingSources") or {}
    slip_legs, board_caps = counts.get("slipLegs"), counts.get("boardCaptures")
    if (waiting or attention) and slip_legs is not None and board_caps is not None:
        console.print(
            f"\n  [dim]{slip_legs} of these are your logged slip legs; "
            f"{board_caps} are whole-board calibration captures (not bets).[/]"
        )


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
        leg_roi = leg.get("legRoi") or {}
        roi_val = leg_roi.get("roi")
        roi_str = ""
        if roi_val is not None:
            roi_color = "green" if roi_val > 0 else "red"
            roi_str = (
                f"   [bold]Straight-bet ROI:[/] [{roi_color}]{_pct(roi_val)}[/] "
                f"[dim](over {leg_roi.get('pricedLegs')} legs with odds)[/]"
            )
        console.print(
            f"[bold]Leg hit rate:[/] {_pct(leg.get('overallHitRate'))} "
            f"over {leg.get('gradedLegs')} graded legs{roi_str}\n"
        )
        table = Table(title="By market", title_style="bold")
        table.add_column("Market")
        table.add_column("Legs", justify="right")
        table.add_column("Wins", justify="right")
        table.add_column("Hit rate", justify="right")
        table.add_column("Priced", justify="right")
        table.add_column("ROI", justify="right")
        for m in leg.get("byMarket", []):
            style = "dim" if not m.get("sufficientSample") else ""
            mroi = m.get("roi")
            roi_cell = "-" if mroi is None else _pct(mroi)
            table.add_row(
                m["market"], str(m["legs"]), str(m.get("wins", "")), _pct(m["hitRate"]),
                str(m.get("pricedLegs", 0)), roi_cell, style=style
            )
        console.print(table)
        console.print(
            "[dim]Priced = legs that carry their own odds (imported history is hit-rate only). "
            "ROI is straight-bet, per leg.[/]"
        )
        cold = leg.get("coldMarkets") or []
        if cold:
            names = ", ".join(c["market"] for c in cold)
            console.print(f"\n[bold red]Cold markets (hit < 50% on real sample):[/] {names}")
        losing = leg.get("losingMarkets") or []
        if losing:
            names = ", ".join(f"{m['market']} ({_pct(m['roi'])})" for m in losing)
            console.print(f"[bold red]Losing money (negative ROI on priced sample):[/] {names}")
    else:
        console.print("[yellow]No graded legs yet - log live slips and let them settle.[/]")

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

    _print_block_engine_sections(report, console)
    console.print("\n[dim]Read-only report. Close this window whenever you're done.[/]")


def _print_block_engine_sections(report: dict[str, Any], console: Console) -> None:
    """Realized ROI by slip structure and by thesis tag (thesis-block engine)."""
    structures = (report.get("structurePerformance") or {}).get("structures") or []
    rated_structures = [s for s in structures if s.get("structure") not in (None, "untagged")]
    if rated_structures:
        table = Table(title="ROI by structure", title_style="bold")
        table.add_column("Structure")
        table.add_column("Slips", justify="right")
        table.add_column("Win rate", justify="right")
        table.add_column("ROI", justify="right")
        for s in rated_structures:
            style = "green" if (s.get("roi") or 0) > 0 else "red"
            table.add_row(s["structure"], str(s["slips"]), _pct(s.get("winRate")), f"[{style}]{_pct(s.get('roi'))}[/]")
        console.print(table)

    theses = (report.get("thesisPerformance") or {}).get("theses") or []
    rated_theses = [t for t in theses if t.get("thesisTag") not in (None, "untagged")]
    if rated_theses:
        table = Table(title="ROI by thesis", title_style="bold")
        table.add_column("Thesis tag")
        table.add_column("Slips", justify="right")
        table.add_column("Win rate", justify="right")
        table.add_column("ROI", justify="right")
        for t in rated_theses:
            style = "green" if (t.get("roi") or 0) > 0 else "red"
            table.add_row(t["thesisTag"], str(t["slips"]), _pct(t.get("winRate")), f"[{style}]{_pct(t.get('roi'))}[/]")
        console.print(table)
        losing = (report.get("thesisPerformance") or {}).get("losingTheses") or []
        if losing:
            console.print(f"[bold red]Losing theses (negative ROI, ≥5 slips):[/] {', '.join(losing)}")


def print_trainer_report(report: dict[str, Any], *, console: Console | None = None) -> None:
    console = console or Console()
    console.rule("[bold magenta]TRAINER  -  Grade + Recalibrate")

    grade = report.get("grade", {})
    graded = grade.get("graded", 0) or 0
    outcomes = grade.get("outcomes", {})
    console.print(f"[bold]Grading[/]  (slate: {grade.get('slateDate') or 'all pending'})")
    console.print(
        f"  Considered: {_num(grade.get('pendingConsidered'))}   "
        f"Graded: [bold]{graded}[/]   "
        f"Not final yet: {_num(grade.get('skippedUnresolved'))}"
    )
    auto_voided = grade.get("autoVoidedNoGame", 0) or 0
    if auto_voided:
        console.print(
            f"  [dim]Auto-voided {auto_voided} leg(s): player had no game on the "
            f"slate date (DNP/scratch) - cleared from pending, excluded from calibration.[/]"
        )
    if graded:
        console.print(
            f"  Outcomes - [green]wins {outcomes.get('win', 0)}[/], "
            f"[red]losses {outcomes.get('loss', 0)}[/], "
            f"pushes {outcomes.get('push', 0)}, void {outcomes.get('void', 0)}"
        )
        console.print(f"  Slips settled: {grade.get('slips', {}).get('slipsSettled', 0)}")
    else:
        console.print("  [yellow]Nothing new to grade - normal until logged live slips finish.[/]")

    _print_pending_sections(console, grade)

    cal = report.get("calibrate", {})
    samples = cal.get("gradedSamples", 0) or 0
    console.print("\n[bold]Calibration[/]")
    console.print(f"  Model-scored graded samples: [bold]{samples}[/]")
    console.print(f"  Markets re-corrected: {cal.get('marketsCorrected', 0)}")
    console.print(f"  Correlation categories measured: {cal.get('correlationCategoriesMeasured', 0)}")
    killed = cal.get("killedMarkets") or []
    if killed:
        console.print(f"  [bold red]Markets killed (negative realized ROI):[/] {', '.join(killed)}")
    overall = cal.get("overall", {})
    if overall.get("count"):
        console.print(
            f"  Overall - Brier {_num(overall.get('brier'))}, "
            f"hit rate {_pct(overall.get('hitRate'))} over {overall.get('count')} samples"
        )
    if not samples:
        console.print(
            "  [dim]Platt calibration needs graded picks that carry a model probability; "
            "it fills in as logged live slips settle.[/]"
        )

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
        _print_pending_sections(console, report)
        console.print("\n[dim]Close this window whenever you're done.[/]")
        return

    err = report.get("calibrationError")
    err_pct = (err or 0) * 100
    if err_pct <= 2:
        verdict = "[bold green]Excellent[/] - predictions match reality closely."
    elif err_pct <= 5:
        verdict = "[bold yellow]Decent[/] - minor drift between predicted and actual."
    else:
        verdict = "[bold red]Off[/] - the model is mis-stating probabilities; calibration will correct it over time."

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
        console.print("[dim]Small-sample rows (<10 picks) are dimmed - trust the aggregate.[/]")

    _print_coverage(report, console)
    _print_pending_sections(console, report)
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
