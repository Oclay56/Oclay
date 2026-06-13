"""Backtest harness: replay the graded ledger to measure real performance.

Two questions this answers, both from your own settled history:

1. How have the bets actually performed? Realized leg hit rate and slip ROI,
   sliced by market, by parlay size, and by line -- the ground truth that
   tells you which markets and which slip shapes have made or lost money.

2. Does OCLAY's model add signal? For picks that carry a model probability,
   the calibration (Brier score) and reliability curve show whether a higher
   estimated probability really did win more often than a lower one.

It reads only settled rows, so it runs on imported Stake history immediately
and grows sharper as organically-scored picks settle. Nothing here mutates the
ledger; it is a pure read-and-report pass.
"""

from __future__ import annotations

from typing import Any

from .pick_ledger import GRADE_LOSS, GRADE_PUSH, GRADE_WIN, PickLedger


# A market needs at least this many graded legs before its hit rate is worth
# reading; below it, the rate is noise.
DEFAULT_MIN_MARKET_SAMPLES = 15
# Reliability buckets for the model-calibration curve.
RELIABILITY_BUCKETS = 10


def run_backtest(
    ledger: PickLedger | None = None,
    *,
    min_market_samples: int = DEFAULT_MIN_MARKET_SAMPLES,
) -> dict[str, Any]:
    """Replay settled ledger history into a realized-performance report."""
    ledger = ledger or PickLedger()
    picks = ledger.settled_picks()
    slips = ledger.decided_slips()
    tagged_slips = ledger.decided_slips_with_legs()
    return {
        "sampleSize": {
            "settledPicks": len(picks),
            "decidedSlips": len(slips),
        },
        "legPerformance": _leg_performance(picks, min_market_samples),
        "slipPerformance": _slip_performance(slips),
        "structurePerformance": _structure_performance(tagged_slips),
        "thesisPerformance": _thesis_performance(tagged_slips),
        "modelCalibration": _model_calibration(picks),
    }


def _slip_pnl(slip: dict[str, Any]) -> float | None:
    """Flat-stake profit for one decided slip at its quoted odds."""
    odds = _float(slip.get("raw_product_odds"))
    if odds is None or odds <= 1.0 or slip.get("result") not in {GRADE_WIN, GRADE_LOSS}:
        return None
    return (odds - 1.0) if slip.get("result") == GRADE_WIN else -1.0


def _roi_group(rows: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    """Group (key, slip) pairs into win-rate + ROI rows on priced slips."""
    buckets: dict[str, dict[str, float]] = {}
    for key, slip in rows:
        pnl = _slip_pnl(slip)
        if pnl is None:
            continue
        bucket = buckets.setdefault(key, {"n": 0.0, "wins": 0.0, "profit": 0.0})
        bucket["n"] += 1
        bucket["wins"] += 1 if slip.get("result") == GRADE_WIN else 0
        bucket["profit"] += pnl
    out = []
    for key, b in buckets.items():
        n = b["n"]
        out.append(
            {
                "key": key,
                "slips": int(n),
                "winRate": round(b["wins"] / n, 4) if n else None,
                "roi": round(b["profit"] / n, 4) if n else None,
                "unitsProfit": round(b["profit"], 4),
            }
        )
    out.sort(key=lambda r: (-r["slips"], r["key"]))
    return out


def _structure_performance(slips: list[dict[str, Any]]) -> dict[str, Any]:
    """Realized ROI sliced by slip structure (e.g. ``3-block`` vs ``5-block``)."""
    grouped = _roi_group([(str(s.get("structure") or "untagged"), s) for s in slips])
    structures = [{"structure": r["key"], **{k: v for k, v in r.items() if k != "key"}} for r in grouped]
    return {
        "structures": structures,
        "losingStructures": [
            r["structure"] for r in structures
            if r["roi"] is not None and r["roi"] < 0 and r["slips"] >= 5
        ],
    }


def _thesis_performance(slips: list[dict[str, Any]]) -> dict[str, Any]:
    """Realized ROI sliced by thesis tag (a slip counts toward each tag it carries)."""
    rows: list[tuple[str, dict[str, Any]]] = []
    for slip in slips:
        for tag in slip.get("thesisTags") or ["untagged"]:
            rows.append((str(tag), slip))
    grouped = _roi_group(rows)
    theses = [{"thesisTag": r["key"], **{k: v for k, v in r.items() if k != "key"}} for r in grouped]
    return {
        "theses": theses,
        "losingTheses": [
            r["thesisTag"] for r in theses
            if r["roi"] is not None and r["roi"] < 0 and r["slips"] >= 5
        ],
    }


def _leg_performance(picks: list[dict[str, Any]], min_market_samples: int) -> dict[str, Any]:
    decisive = [p for p in picks if p.get("outcome") in {GRADE_WIN, GRADE_LOSS}]
    wins = sum(1 for p in decisive if p.get("outcome") == GRADE_WIN)
    pushes = sum(1 for p in picks if p.get("outcome") == GRADE_PUSH)
    total = len(decisive)

    by_market: dict[str, dict[str, Any]] = {}
    for pick in decisive:
        market = str(pick.get("market_key") or "unknown")
        side = str(pick.get("side") or "").lower()
        key = f"{market}:{side}" if side else market
        bucket = by_market.setdefault(key, {"win": 0, "loss": 0, "pricedLegs": 0, "profit": 0.0})
        bucket[pick.get("outcome")] += 1
        # Per-leg realized ROI needs each leg's own odds. Legs that arrived
        # without odds (e.g. imported Stake history) still count toward hit rate
        # but are simply left out of the money math -- never faked.
        odds = _float(pick.get("odds"))
        if odds and odds > 1.0:
            bucket["pricedLegs"] += 1
            bucket["profit"] += (odds - 1.0) if pick.get("outcome") == GRADE_WIN else -1.0

    markets = []
    priced_total = 0
    profit_total = 0.0
    for key, counts in by_market.items():
        n = counts["win"] + counts["loss"]
        priced = counts["pricedLegs"]
        priced_total += priced
        profit_total += counts["profit"]
        markets.append(
            {
                "market": key,
                "legs": n,
                "wins": counts["win"],
                "hitRate": round(counts["win"] / n, 4) if n else None,
                "pricedLegs": priced,
                "roi": round(counts["profit"] / priced, 4) if priced else None,
                "sufficientSample": n >= min_market_samples,
            }
        )
    markets.sort(key=lambda m: (-m["legs"], m["market"]))

    # Markets that have enough sample yet hit below half (hit-rate signal).
    cold = [
        m
        for m in markets
        if m["sufficientSample"] and m["hitRate"] is not None and m["hitRate"] < 0.5
    ]
    # Markets losing real money on a real priced sample (ROI signal -- the same
    # thing the kill-switch acts on, surfaced here for the eye).
    losing = [
        m
        for m in markets
        if m["roi"] is not None and m["pricedLegs"] >= min_market_samples and m["roi"] < 0
    ]

    return {
        "gradedLegs": total,
        "pushes": pushes,
        "wins": wins,
        "overallHitRate": round(wins / total, 4) if total else None,
        # Straight-bet ROI: how each leg would have done bet on its own, over the
        # legs that carry odds. The slip-level ROI (parlayed) is reported separately.
        "legRoi": {
            "pricedLegs": priced_total,
            "unitsProfit": round(profit_total, 4),
            "roi": round(profit_total / priced_total, 4) if priced_total else None,
        },
        "byMarket": markets,
        "coldMarkets": cold,
        "losingMarkets": losing,
    }


def _slip_performance(slips: list[dict[str, Any]]) -> dict[str, Any]:
    decided = [s for s in slips if s.get("result") in {GRADE_WIN, GRADE_LOSS}]
    priced = [
        s
        for s in decided
        if _float(s.get("raw_product_odds")) and _float(s.get("raw_product_odds")) > 1.0
    ]
    wins = sum(1 for s in decided if s.get("result") == GRADE_WIN)

    profit = 0.0
    for slip in priced:
        odds = _float(slip.get("raw_product_odds")) or 0.0
        if slip.get("result") == GRADE_WIN:
            profit += odds - 1.0
        else:
            profit -= 1.0

    by_leg_count = _slip_roi_by_leg_count(priced)

    return {
        "decidedSlips": len(decided),
        "pricedSlips": len(priced),
        "winRate": round(wins / len(decided), 4) if decided else None,
        "unitsStaked": len(priced),
        "unitsProfit": round(profit, 4),
        "roi": round(profit / len(priced), 4) if priced else None,
        "byLegCount": by_leg_count,
    }


def _slip_roi_by_leg_count(priced: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[int, dict[str, float]] = {}
    for slip in priced:
        legs = _int(slip.get("leg_count")) or 0
        bucket = buckets.setdefault(legs, {"n": 0.0, "wins": 0.0, "profit": 0.0})
        odds = _float(slip.get("raw_product_odds")) or 0.0
        bucket["n"] += 1
        if slip.get("result") == GRADE_WIN:
            bucket["wins"] += 1
            bucket["profit"] += odds - 1.0
        else:
            bucket["profit"] -= 1.0

    out = []
    for legs in sorted(buckets):
        b = buckets[legs]
        n = b["n"]
        out.append(
            {
                "legCount": legs,
                "slips": int(n),
                "winRate": round(b["wins"] / n, 4) if n else None,
                "roi": round(b["profit"] / n, 4) if n else None,
            }
        )
    return out


def _model_calibration(picks: list[dict[str, Any]]) -> dict[str, Any]:
    scored = [
        p
        for p in picks
        if p.get("outcome") in {GRADE_WIN, GRADE_LOSS}
        and _float(p.get("estimated_probability")) is not None
    ]
    if not scored:
        return {
            "status": "no_model_scored_history_yet",
            "scoredLegs": 0,
            "note": "Imported history has no model estimate; this fills in as organically scored picks settle.",
        }

    brier = 0.0
    base_wins = 0
    bucket_stats: list[dict[str, float]] = [
        {"n": 0.0, "predicted": 0.0, "wins": 0.0} for _ in range(RELIABILITY_BUCKETS)
    ]
    for pick in scored:
        p = _float(pick.get("estimated_probability")) or 0.0
        p = min(1.0, max(0.0, p))
        y = 1.0 if pick.get("outcome") == GRADE_WIN else 0.0
        brier += (p - y) ** 2
        base_wins += int(y)
        idx = min(RELIABILITY_BUCKETS - 1, int(p * RELIABILITY_BUCKETS))
        bucket_stats[idx]["n"] += 1
        bucket_stats[idx]["predicted"] += p
        bucket_stats[idx]["wins"] += y

    n = len(scored)
    reliability = []
    for i, b in enumerate(bucket_stats):
        if b["n"] == 0:
            continue
        reliability.append(
            {
                "bucket": f"{i / RELIABILITY_BUCKETS:.1f}-{(i + 1) / RELIABILITY_BUCKETS:.1f}",
                "legs": int(b["n"]),
                "meanPredicted": round(b["predicted"] / b["n"], 4),
                "actualHitRate": round(b["wins"] / b["n"], 4),
            }
        )

    return {
        "status": "ok",
        "scoredLegs": n,
        "brierScore": round(brier / n, 4),
        "baseHitRate": round(base_wins / n, 4),
        "reliabilityCurve": reliability,
    }


def _float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
