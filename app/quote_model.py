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
from typing import Any

from .correlation import slip_probability_and_ev


# The learned scalar is shrunk toward 1.0 (pure prior) until this many real
# quotes have been logged.
_LEARN_FULL_WEIGHT_SAMPLES = 40.0
_RATIO_FLOOR = 0.25  # never predict Stake pays less than a quarter of product
_CACHE_SECONDS = 300.0
_model_cache: dict[str, Any] = {"loadedAt": 0.0, "model": None}


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
    # The scalar that would have made the prior exactly match reality.
    realized_scalar = (real_quote / product) / prior_ratio
    return {
        "productOdds": round(float(product), 4),
        "priorRepricingRatio": round(float(prior_ratio), 4),
        "realQuote": round(float(real_quote), 4),
        "realizedScalar": round(float(realized_scalar), 4),
    }


def fit_quote_model(observations: list[dict[str, Any]]) -> dict[str, Any]:
    """Fit the repricing scalar from logged observations (robust median)."""
    scalars = [
        _float(obs.get("realizedScalar"))
        for obs in observations
        if _float(obs.get("realizedScalar")) is not None
    ]
    scalars = [s for s in scalars if s is not None and 0.1 <= s <= 3.0]
    n = len(scalars)
    if n == 0:
        return {"scalar": 1.0, "samples": 0}
    scalars.sort()
    median = scalars[n // 2] if n % 2 else (scalars[n // 2 - 1] + scalars[n // 2]) / 2
    return {"scalar": round(median, 4), "samples": n}


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
