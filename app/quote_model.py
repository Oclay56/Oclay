"""Predict Stake's real same-game-parlay quote before the slip is built.

Stake reprices correlated SGM legs downward, so its combined quote is lower
than the naive product of leg odds. The real-quote check already measures
this gap at review time; this module predicts it at candidate time so the
EV-max builder optimizes against the price Stake will actually offer, not the
inflated product.

Principled prior (no data needed): a parlay's fair combined odds are
1 / joint_win_probability. The naive product corresponds to treating legs as
independent, so

    predicted_quote ≈ product_odds × (independence_prob / correlated_prob)

where correlated_prob comes from the same single-factor copula used
everywhere else. Positive correlation makes correlated_prob > independence
_prob, so the predicted quote sits below the product — exactly Stake's tax.

That prior is then scaled by a factor learned from logged (product, real
quote) pairs, so the prediction tightens to Stake's actual repricing as real
quotes accumulate.
"""

from __future__ import annotations

import os
import time
from collections import Counter
from typing import Any

from .correlation import leg_pair_category, slip_probability_and_ev


# The learned scalar is shrunk toward 1.0 (pure prior) until this many real
# quotes have been logged.
_LEARN_FULL_WEIGHT_SAMPLES = 40.0
_RATIO_FLOOR = 0.25  # never predict Stake pays less than a quarter of product
_CACHE_SECONDS = 300.0
_model_cache: dict[str, Any] = {"loadedAt": 0.0, "model": None}

# Correlation-mispricing edge: per-category repricing scalar shrunk toward the
# global baseline by sample count. scalar > 1 means Stake's real quotes on this
# structure run more generous than the realized-co-hit copula expects -- Stake
# under-prices the correlation, a structural overlay. < 1 means it over-credits.
_EDGE_FULL_WEIGHT_SAMPLES = 15.0
_EDGE_UNDERPRICE_THRESHOLD = 1.05
_EDGE_OVERCREDIT_THRESHOLD = 0.95
_EDGE_MEASURED_MIN_SAMPLES = 12


def _dominant_correlation_category(legs: list[dict[str, Any]]) -> str | None:
    """The most common same-game pairwise correlation category across the legs.

    Matches the categories the copula calibration measures phi for, so the
    repricing scalar and the realized correlation are bucketed the same way.
    """
    categories: Counter[str] = Counter()
    for i in range(len(legs)):
        for j in range(i + 1, len(legs)):
            category = leg_pair_category(legs[i], legs[j])
            if category and category != "different_game":
                categories[category] += 1
    if not categories:
        return None
    return categories.most_common(1)[0][0]


def predict_sgm_quote(legs: list[dict[str, Any]], *, model: dict[str, Any] | None = None) -> dict[str, Any]:
    """Estimate the combined SGM price Stake will quote for these legs."""
    projection = slip_probability_and_ev(legs)
    product = projection.get("rawProductOdds") or 0.0
    independence = projection.get("independenceWinProbability")
    correlated = projection.get("estimatedWinProbability")

    if not product or independence is None or correlated is None or correlated <= 0:
        return {
            "predictedQuote": round(product, 4) if product else None,
            "productOdds": round(product, 4) if product else None,
            "repricingRatio": 1.0,
            "method": "product_no_correlation_signal",
            "fullyPriced": projection.get("fullyPriced", False),
        }

    prior_ratio = max(_RATIO_FLOOR, min(1.0, independence / correlated))
    scalar = _learned_scalar(model)
    ratio = max(_RATIO_FLOOR, min(1.05, prior_ratio * scalar))
    predicted = product * ratio
    return {
        "predictedQuote": round(predicted, 4),
        "productOdds": round(product, 4),
        "priorRepricingRatio": round(prior_ratio, 4),
        "learnedScalar": round(scalar, 4),
        "repricingRatio": round(ratio, 4),
        "correlationTax": round(product - predicted, 4),
        "method": "copula_ratio_with_learned_scalar",
        "fullyPriced": projection.get("fullyPriced", False),
        "note": (
            "predictedQuote estimates Stake's repriced SGM odds; it tightens to "
            "real quotes as observations are logged."
        ),
    }


def slip_projection(legs: list[dict[str, Any]]) -> dict[str, Any]:
    """Correlation-aware slip projection with EV scored at the predicted quote.

    Same shape as correlation.slip_probability_and_ev, but expectedValue is
    computed against Stake's predicted repriced quote (the price you can
    actually get) rather than the naive product of leg odds.
    """
    projection = dict(slip_probability_and_ev(legs))
    prediction = predict_sgm_quote(legs)
    win = projection.get("estimatedWinProbability")
    predicted_quote = prediction.get("predictedQuote")
    projection["predictedQuote"] = predicted_quote
    projection["productExpectedValue"] = projection.get("expectedValue")
    if win is not None and predicted_quote and predicted_quote > 1.0:
        projection["expectedValue"] = round(win * (predicted_quote - 1.0) - (1.0 - win), 4)
        projection["expectedValuePerUnit"] = projection["expectedValue"]
    projection["quoteRepricing"] = prediction
    return projection


def quote_observation(legs: list[dict[str, Any]], real_quote: float | None) -> dict[str, Any] | None:
    """Build a training observation from a real review-time quote."""
    if real_quote is None or real_quote <= 1.0:
        return None
    prediction = predict_sgm_quote(legs)
    product = prediction.get("productOdds")
    prior_ratio = prediction.get("priorRepricingRatio")
    if not product or prior_ratio in (None, 0):
        return None
    # The scalar that would have made the prior exactly match reality. This is
    # exactly M_model / M_stake_real -- the correlation-mispricing ratio: > 1
    # means Stake's real quote credited less correlation than the copula.
    realized_scalar = (real_quote / product) / prior_ratio
    return {
        "productOdds": round(float(product), 4),
        "priorRepricingRatio": round(float(prior_ratio), 4),
        "realQuote": round(float(real_quote), 4),
        "realizedScalar": round(float(realized_scalar), 4),
        "correlationCategory": _dominant_correlation_category(legs),
    }


def _median(values: list[float]) -> float:
    values = sorted(values)
    k = len(values)
    return values[k // 2] if k % 2 else (values[k // 2 - 1] + values[k // 2]) / 2


def fit_quote_model(observations: list[dict[str, Any]]) -> dict[str, Any]:
    """Fit the repricing scalar from logged observations (robust median).

    Also buckets the scalar by correlation category for the mispricing edge.
    """
    all_scalars: list[float] = []
    by_category: dict[str, list[float]] = {}
    for obs in observations:
        s = _float(obs.get("realizedScalar"))
        if s is None or not (0.1 <= s <= 3.0):
            continue
        all_scalars.append(s)
        category = obs.get("correlationCategory")
        if category:
            by_category.setdefault(str(category), []).append(s)
    if not all_scalars:
        return {"scalar": 1.0, "samples": 0, "byCategory": {}}
    return {
        "scalar": round(_median(all_scalars), 4),
        "samples": len(all_scalars),
        "byCategory": {
            category: {"scalar": round(_median(vals), 4), "samples": len(vals)}
            for category, vals in by_category.items()
        },
    }


def correlation_edge(
    legs: list[dict[str, Any]], *, model: dict[str, Any] | None = None
) -> dict[str, Any]:
    """How much Stake mis-prices THIS block's correlation structure.

    Reads only the real-quote ``realizedScalar`` (M_model / M_stake_real),
    bucketed by the block's dominant correlation category, shrunk toward the
    global baseline by sample count. It never touches the predicted quote, so
    it is not circular: a category whose scalar runs > 1 is one where Stake's
    real quotes have historically been more generous than the realized-co-hit
    copula expects -- a structural overlay you can hunt for.
    """
    model = model if model is not None else get_active_quote_model()
    model = model or {}
    global_scalar = _float(model.get("scalar")) or 1.0
    category = _dominant_correlation_category(legs)
    cat = ((model.get("byCategory") or {}).get(category) if category else None) or {}
    samples = int(_float(cat.get("samples")) or 0)
    raw = _float(cat.get("scalar"))

    if raw is not None and samples > 0:
        weight = samples / (samples + _EDGE_FULL_WEIGHT_SAMPLES)
        scalar = (1.0 - weight) * global_scalar + weight * raw
        confidence = "measured" if samples >= _EDGE_MEASURED_MIN_SAMPLES else "thin"
    else:
        scalar = global_scalar
        confidence = "baseline" if model.get("samples") else "prior"

    if scalar >= _EDGE_UNDERPRICE_THRESHOLD:
        direction = "stake_underprices_correlation"
        interpretation = (
            f"Stake's real quotes on {category or 'this structure'} run more generous than "
            "the realized-co-hit copula -- a structural correlation overlay."
        )
    elif scalar <= _EDGE_OVERCREDIT_THRESHOLD:
        direction = "stake_overcredits_correlation"
        interpretation = (
            f"Stake over-credits {category or 'this structure'} correlation -- you would "
            "overpay; prefer a structure Stake prices fairly or under-prices."
        )
    else:
        direction = "fairly_priced"
        interpretation = (
            f"Stake prices {category or 'this structure'} correlation in line with realized co-hits."
        )

    return {
        "category": category,
        "samples": samples,
        "stakeRepricingScalar": round(scalar, 4),
        "edgeRatio": round(scalar, 4),
        "vsGlobalBaseline": round(scalar / global_scalar, 4) if global_scalar else None,
        "edgeDirection": direction,
        "confidence": confidence,
        "interpretation": interpretation,
    }


def get_active_quote_model(*, force_reload: bool = False) -> dict[str, Any] | None:
    if os.getenv("OCLAY_DISABLE_QUOTE_MODEL", "").strip().lower() in {"1", "true", "yes"}:
        return None
    now = time.monotonic()
    if not force_reload and now - _model_cache["loadedAt"] < _CACHE_SECONDS:
        return _model_cache["model"]
    model: dict[str, Any] | None = None
    try:
        from .pick_ledger import PickLedger

        model = PickLedger().load_quote_model()
    except Exception:
        model = None
    _model_cache["loadedAt"] = now
    _model_cache["model"] = model
    return model


def invalidate_quote_model_cache() -> None:
    _model_cache["loadedAt"] = 0.0
    _model_cache["model"] = None


def _learned_scalar(model: dict[str, Any] | None) -> float:
    model = model if model is not None else get_active_quote_model()
    if not model:
        return 1.0
    scalar = _float(model.get("scalar"))
    samples = int(_float(model.get("samples")) or 0)
    if scalar is None or samples <= 0:
        return 1.0
    weight = samples / (samples + _LEARN_FULL_WEIGHT_SAMPLES)
    return (1.0 - weight) * 1.0 + weight * scalar


def _float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
