"""Calibration engine: measures whether OCLAY's probabilities are honest.

Reads graded picks from the ledger and answers the only question that
matters for the mission: when OCLAY says a leg is 60% to hit, does it hit
60% of the time? It produces:

- Brier score and log loss (overall and per market).
- Reliability buckets (predicted vs. observed hit rate).
- A fitted Platt correction per market (logistic regression of the
  realized outcome on the predicted logit), regularized toward the
  identity map so thin samples barely move the estimate.

The fitted corrections are written back to the ledger; the probability
engine loads them and blends them in, weighted by graded sample size.
That is the self-correcting loop, expressed as math rather than vibes.
"""

from __future__ import annotations

import math
from typing import Any

from .pick_ledger import GRADE_WIN, PickLedger


# Ridge-style regularization that pulls the fit toward (intercept=0,
# slope=1), i.e. "trust the model" until data earns a correction.
_PRIOR_STRENGTH = 25.0
_MIN_SAMPLES_TO_FIT = 30
_BUCKET_EDGES = (0.0, 0.35, 0.45, 0.5, 0.55, 0.6, 0.7, 0.85, 1.0)
_PROB_FLOOR = 0.02
_PROB_CEILING = 0.98


def build_calibration_report(
    *,
    ledger: PickLedger | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """Compute calibration metrics and (optionally) persist corrections."""
    ledger = ledger or PickLedger()
    graded = ledger.graded_picks()
    samples = [_sample(row) for row in graded]
    samples = [s for s in samples if s is not None]

    overall = _metrics(samples)
    by_market = _metrics_by_market(samples)
    by_edge_status = _grouped_hit_rate(samples, key="edge_status")
    by_reliability = _grouped_hit_rate(samples, key="reliability_band")

    corrections = _fit_all_corrections(samples)
    if persist and corrections:
        ledger.save_calibrations(corrections)

    return {
        "purpose": "probability_calibration_report",
        "gradedSamples": len(samples),
        "overall": overall,
        "byMarket": by_market,
        "byEdgeStatus": by_edge_status,
        "byReliabilityBand": by_reliability,
        "corrections": corrections,
        "correctionsPersisted": bool(persist and corrections),
        "notes": [
            "Brier and log loss are lower-is-better; a 50/50 coin scores Brier 0.25.",
            "Reliability buckets compare predicted probability against observed hit rate.",
            "Corrections are Platt-scaled per market and regularized toward the identity map.",
            "Corrections only meaningfully bend estimates once a market has a few hundred graded picks.",
        ],
    }


def refit_and_persist(*, ledger: PickLedger | None = None) -> dict[str, Any]:
    ledger = ledger or PickLedger()
    samples = [_sample(row) for row in ledger.graded_picks()]
    samples = [s for s in samples if s is not None]
    corrections = _fit_all_corrections(samples)
    saved = ledger.save_calibrations(corrections) if corrections else 0
    return {"marketsFitted": saved, "gradedSamples": len(samples)}


def _sample(row: dict[str, Any]) -> dict[str, Any] | None:
    predicted = _float_or_none(row.get("estimated_probability"))
    outcome = str(row.get("outcome") or "")
    if predicted is None or outcome not in {GRADE_WIN, "loss"}:
        return None
    return {
        "market_key": str(row.get("market_key") or "unknown"),
        "edge_status": str(row.get("edge_status") or "unknown"),
        "reliability_band": str(row.get("reliability_band") or "unknown"),
        "predicted": _clamp(predicted),
        "hit": 1.0 if outcome == GRADE_WIN else 0.0,
    }


def _metrics(samples: list[dict[str, Any]]) -> dict[str, Any]:
    if not samples:
        return {"count": 0, "brier": None, "logLoss": None, "hitRate": None, "meanPredicted": None}
    n = len(samples)
    brier = sum((s["predicted"] - s["hit"]) ** 2 for s in samples) / n
    log_loss = -sum(
        s["hit"] * math.log(s["predicted"]) + (1 - s["hit"]) * math.log(1 - s["predicted"])
        for s in samples
    ) / n
    hit_rate = sum(s["hit"] for s in samples) / n
    mean_pred = sum(s["predicted"] for s in samples) / n
    return {
        "count": n,
        "brier": round(brier, 4),
        "logLoss": round(log_loss, 4),
        "hitRate": round(hit_rate, 4),
        "meanPredicted": round(mean_pred, 4),
        "calibrationGap": round(mean_pred - hit_rate, 4),
        "reliabilityBuckets": _reliability_buckets(samples),
    }


def _metrics_by_market(samples: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for s in samples:
        groups.setdefault(s["market_key"], []).append(s)
    return {market: _metrics(group) for market, group in sorted(groups.items())}


def _grouped_hit_rate(samples: list[dict[str, Any]], *, key: str) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for s in samples:
        groups.setdefault(s[key], []).append(s)
    out: dict[str, Any] = {}
    for label, group in sorted(groups.items()):
        n = len(group)
        out[label] = {
            "count": n,
            "hitRate": round(sum(g["hit"] for g in group) / n, 4),
            "meanPredicted": round(sum(g["predicted"] for g in group) / n, 4),
        }
    return out


def _reliability_buckets(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: list[dict[str, Any]] = []
    for low, high in zip(_BUCKET_EDGES, _BUCKET_EDGES[1:]):
        in_bucket = [
            s for s in samples
            if (s["predicted"] >= low and s["predicted"] < high)
            or (high == _BUCKET_EDGES[-1] and s["predicted"] == high)
        ]
        if not in_bucket:
            continue
        n = len(in_bucket)
        buckets.append(
            {
                "range": [low, high],
                "count": n,
                "predicted": round(sum(s["predicted"] for s in in_bucket) / n, 4),
                "observed": round(sum(s["hit"] for s in in_bucket) / n, 4),
            }
        )
    return buckets


def _fit_all_corrections(samples: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for s in samples:
        groups.setdefault(s["market_key"], []).append(s)
    corrections: dict[str, dict[str, Any]] = {}
    for market, group in groups.items():
        if len(group) < _MIN_SAMPLES_TO_FIT:
            continue
        fit = _fit_platt(group)
        if fit is not None:
            corrections[market] = fit
    return corrections


def _fit_platt(samples: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Logistic regression: hit ~ sigmoid(a + b * logit(predicted)).

    Solved with a few Newton steps and a ridge prior centered on the
    identity map (a=0, b=1). Pure Python; no numpy.
    """
    xs = [_logit(s["predicted"]) for s in samples]
    ys = [s["hit"] for s in samples]
    n = len(samples)
    a, b = 0.0, 1.0
    prior_a, prior_b = 0.0, 1.0

    for _ in range(25):
        g_a = g_b = 0.0
        h_aa = h_ab = h_bb = 0.0
        for x, y in zip(xs, ys):
            p = _sigmoid(a + b * x)
            w = max(p * (1 - p), 1e-6)
            err = p - y
            g_a += err
            g_b += err * x
            h_aa += w
            h_ab += w * x
            h_bb += w * x * x
        # Ridge prior toward (0, 1).
        g_a += _PRIOR_STRENGTH * (a - prior_a)
        g_b += _PRIOR_STRENGTH * (b - prior_b)
        h_aa += _PRIOR_STRENGTH
        h_bb += _PRIOR_STRENGTH
        det = h_aa * h_bb - h_ab * h_ab
        if abs(det) < 1e-9:
            break
        step_a = (h_bb * g_a - h_ab * g_b) / det
        step_b = (h_aa * g_b - h_ab * g_a) / det
        a -= step_a
        b -= step_b
        if abs(step_a) < 1e-7 and abs(step_b) < 1e-7:
            break

    if not (math.isfinite(a) and math.isfinite(b)):
        return None
    brier = sum((_sigmoid(a + b * x) - y) ** 2 for x, y in zip(xs, ys)) / n
    return {
        "intercept": round(a, 5),
        "slope": round(b, 5),
        "samples": n,
        "brier": round(brier, 4),
    }


def _logit(probability: float) -> float:
    p = _clamp(probability)
    return math.log(p / (1.0 - p))


def _sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-value)
        return 1.0 / (1.0 + z)
    z = math.exp(value)
    return z / (1.0 + z)


def _clamp(value: float) -> float:
    return max(_PROB_FLOOR, min(_PROB_CEILING, float(value)))


def _float_or_none(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
