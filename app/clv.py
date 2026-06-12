"""Closing Line Value: the fast truth-detector for a betting edge.

Realized win/loss is noisy and takes a full season to mean anything. CLV --
how the price you took compares to the price the market closed at -- converges
in weeks. Consistently beating the close is the single best early signal that
a process has an edge, even before the wins show up in the bankroll.

This reads picks that carry both a taken price (``odds``) and a captured
closing price (``closing_odds``) and reports: the share of picks that beat the
close, the average CLV, and -- when those picks have also graded -- whether
beating the close actually tracked with winning. Nothing here mutates the
ledger; it is a pure read.
"""

from __future__ import annotations

from typing import Any

from .pick_ledger import GRADE_LOSS, GRADE_WIN, PickLedger


# A market needs at least this many priced picks before its CLV is worth reading.
DEFAULT_MIN_MARKET_SAMPLES = 10


def clv_report(
    ledger: PickLedger | None = None,
    *,
    min_market_samples: int = DEFAULT_MIN_MARKET_SAMPLES,
) -> dict[str, Any]:
    """Closing-line-value summary over picks with a captured closing price."""
    ledger = ledger or PickLedger()
    picks = ledger.picks_with_closing()
    rows = [r for r in (_clv_row(p) for p in picks) if r is not None]
    if not rows:
        return {
            "status": "no_closing_lines_yet",
            "pricedPicks": 0,
            "note": (
                "CLV needs closing odds. Re-scan each game's board near first "
                "pitch so the last price seen is captured as the close."
            ),
        }

    beat = sum(1 for r in rows if r["clv"] > 0)
    total_clv = sum(r["clv"] for r in rows)
    n = len(rows)

    return {
        "status": "ok",
        "pricedPicks": n,
        "beatCloseRate": round(beat / n, 4),
        "averageClv": round(total_clv / n, 4),
        "medianClv": _median([r["clv"] for r in rows]),
        "byMarket": _clv_by_market(rows, min_market_samples),
        "clvVsOutcome": _clv_vs_outcome(rows),
    }


def _clv_row(pick: dict[str, Any]) -> dict[str, Any] | None:
    taken = _float(pick.get("odds"))
    close = _float(pick.get("closing_odds"))
    if taken is None or close is None or taken <= 1.0 or close <= 1.0:
        return None
    # Positive CLV = took a longer (better) price than the market closed at.
    clv = (taken / close) - 1.0
    return {
        "clv": clv,
        "market": str(pick.get("market_key") or "unknown"),
        "side": str(pick.get("side") or "").lower(),
        "outcome": pick.get("outcome"),
    }


def _clv_by_market(rows: list[dict[str, Any]], min_samples: int) -> list[dict[str, Any]]:
    buckets: dict[str, list[float]] = {}
    for r in rows:
        key = f"{r['market']}:{r['side']}" if r["side"] else r["market"]
        buckets.setdefault(key, []).append(r["clv"])
    out = []
    for key, values in buckets.items():
        n = len(values)
        beat = sum(1 for v in values if v > 0)
        out.append(
            {
                "market": key,
                "pricedPicks": n,
                "beatCloseRate": round(beat / n, 4),
                "averageClv": round(sum(values) / n, 4),
                "sufficientSample": n >= min_samples,
            }
        )
    out.sort(key=lambda m: (-m["pricedPicks"], m["market"]))
    return out


def _clv_vs_outcome(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Does beating the close track with actually winning? The sanity check."""
    graded = [r for r in rows if r["outcome"] in {GRADE_WIN, GRADE_LOSS}]
    if not graded:
        return {"gradedPricedPicks": 0, "note": "No priced picks have graded yet."}
    beat = [r for r in graded if r["clv"] > 0]
    missed = [r for r in graded if r["clv"] <= 0]
    return {
        "gradedPricedPicks": len(graded),
        "winRateWhenBeatClose": _win_rate(beat),
        "winRateWhenMissedClose": _win_rate(missed),
        "beatCloseCount": len(beat),
        "missedCloseCount": len(missed),
    }


def _win_rate(rows: list[dict[str, Any]]) -> float | None:
    if not rows:
        return None
    wins = sum(1 for r in rows if r["outcome"] == GRADE_WIN)
    return round(wins / len(rows), 4)


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    n = len(ordered)
    if n == 0:
        return 0.0
    mid = n // 2
    if n % 2:
        return round(ordered[mid], 4)
    return round((ordered[mid - 1] + ordered[mid]) / 2.0, 4)


def _float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
