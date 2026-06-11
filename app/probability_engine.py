"""Probability engine for OCLAY candidate legs.

This module replaces the old proxy-blend pseudo-probability with real
probability mathematics:

- Season per-game rates become P(side clears line) through a negative
  binomial survival function whose dispersion follows the market's
  volatility tier (Poisson is the low-dispersion limit).
- The empirical last-15 line-clearing rate is shrunk toward the
  distributional season estimate with empirical-Bayes pseudo-counts, so
  small recent samples cannot dominate.
- Matchup context moves the estimate as a bounded logit shift
  (multiplicative on the odds ratio) instead of being averaged in as if
  it were a probability.
- When both sides of a Stake row are on the board, the vig is removed
  with two-way normalization, so edges are measured against fair odds.
- Per-market calibration corrections fitted from graded ledger picks
  (see app.calibration) are applied on the logit scale, weighted by the
  graded sample size. This is the self-correcting loop: pick -> grade ->
  recalibrate -> better pick.
"""

from __future__ import annotations

import math
import os
import time
from typing import Any

from .decision_profiles import market_profile


# Pseudo-games used to shrink the empirical recent rate toward the
# distributional season estimate. n=10 recent games then carry half the
# blend weight.
RECENT_SHRINKAGE_PSEUDO_GAMES = 10.0

# Logit weight for the matchup factor dial (0.25..0.75 centered at 0.50).
# A full-range factor of 0.75 shifts the estimate by +0.40 logits
# (~ +10 probability points at p=0.5); typical factors (0.42..0.58) move
# the estimate by ~3 points.
MATCHUP_LOGIT_WEIGHT = 1.6

# Calibration corrections only reach full influence once a market has
# this many graded picks behind it.
CALIBRATION_FULL_WEIGHT_SAMPLES = 150.0

# Negative binomial dispersion (size r) per volatility tier. Larger r
# approaches Poisson; smaller r widens the tails.
VOLATILITY_DISPERSION = {
    "low": 30.0,
    "medium": 12.0,
    "high": 5.0,
    "extreme": 2.2,
}

_PROBABILITY_FLOOR = 0.02
_PROBABILITY_CEILING = 0.98

_CALIBRATION_CACHE_SECONDS = 300.0
_calibration_cache: dict[str, Any] = {"loadedAt": 0.0, "corrections": {}}
_market_policy_cache: dict[str, Any] = {"loadedAt": 0.0, "policies": {}}


def implied_probability(odds: Any) -> float | None:
    value = _float_or_none(odds)
    if value is None or value <= 1.0:
        return None
    return round(1.0 / value, 4)


def devig_two_way(side_odds: Any, opposite_odds: Any) -> dict[str, Any]:
    """Remove the bookmaker margin from a two-way over/under pair.

    Returns the fair probability for the priced side plus the measured
    overround. Falls back to raw implied probability (flagged) when the
    opposite side is not on the board.
    """
    raw = implied_probability(side_odds)
    opposite = implied_probability(opposite_odds)
    if raw is None:
        return {
            "impliedProbability": None,
            "fairProbability": None,
            "overround": None,
            "method": "unavailable",
        }
    if opposite is None:
        return {
            "impliedProbability": raw,
            "fairProbability": raw,
            "overround": None,
            "method": "raw_implied_vig_not_removed",
        }
    total = raw + opposite
    return {
        "impliedProbability": raw,
        "fairProbability": round(raw / total, 4),
        "overround": round(total - 1.0, 4),
        "method": "two_way_multiplicative_devig",
    }


def dispersion_for_market(market_key: Any) -> float:
    profile = market_profile(market_key)
    volatility = str(profile.get("volatility") or "high").lower()
    return VOLATILITY_DISPERSION.get(volatility, VOLATILITY_DISPERSION["high"])


def negative_binomial_pmf_sequence(mean: float, dispersion: float, max_count: int) -> list[float]:
    """pmf(0..max_count) for a negative binomial with the given mean.

    Parameterized by mean mu and size r so variance = mu + mu^2 / r.
    Computed iteratively to stay stable without scipy.
    """
    mu = max(float(mean), 1e-9)
    r = max(float(dispersion), 1e-6)
    p_success = r / (r + mu)
    pmf: list[float] = [p_success**r]
    for count in range(max_count):
        pmf.append(pmf[-1] * ((count + r) / (count + 1.0)) * (mu / (r + mu)))
    return pmf


def distributional_line_probability(
    mean: float | None,
    line: float | None,
    side: str,
    *,
    market_key: Any = None,
    dispersion: float | None = None,
) -> dict[str, Any] | None:
    """P(side wins) for a count stat with the given per-game mean.

    For half lines the win and lose probabilities partition everything;
    for integer lines the push mass sits on the line itself.
    """
    mu = _float_or_none(mean)
    numeric_line = _float_or_none(line)
    if mu is None or mu < 0 or numeric_line is None or numeric_line < 0:
        return None
    side = side if side in {"over", "under"} else "under"
    r = dispersion if dispersion is not None else dispersion_for_market(market_key)

    is_integer_line = abs(numeric_line - round(numeric_line)) < 1e-9
    line_floor = int(math.floor(numeric_line + 1e-9))
    # Enough terms that the truncated tail is negligible for MLB lines.
    max_count = max(line_floor + 1, int(mu + 12.0 * math.sqrt(mu + (mu * mu) / r) + 10))
    pmf = negative_binomial_pmf_sequence(mu, r, max_count)

    if is_integer_line:
        under_mass = sum(pmf[:line_floor])
        push_mass = pmf[line_floor] if line_floor < len(pmf) else 0.0
    else:
        under_mass = sum(pmf[: line_floor + 1])
        push_mass = 0.0
    over_mass = max(0.0, 1.0 - under_mass - push_mass)
    win = over_mass if side == "over" else under_mass
    return {
        "winProbability": round(_clamp_probability(win), 4),
        "pushProbability": round(push_mass, 4),
        "distribution": "negative_binomial",
        "mean": round(mu, 4),
        "dispersion": round(r, 4),
        "line": numeric_line,
        "side": side,
    }


def shrink_recent_rate(
    recent_rate: float | None,
    recent_games: int | None,
    prior_rate: float | None,
    *,
    pseudo_games: float = RECENT_SHRINKAGE_PSEUDO_GAMES,
) -> dict[str, Any] | None:
    """Empirical-Bayes blend of the observed recent rate with a prior.

    posterior = (hits + pseudo_games * prior) / (n + pseudo_games)
    """
    prior = _float_or_none(prior_rate)
    rate = _float_or_none(recent_rate)
    games = max(0, int(recent_games or 0))
    if prior is None and rate is None:
        return None
    if prior is None:
        # No distributional prior: shrink toward a neutral coin instead.
        prior = 0.5
        prior_source = "neutral_no_season_prior"
    else:
        prior_source = "distributional_season_estimate"
    if rate is None or games <= 0:
        return {
            "blendedRate": round(_clamp_probability(prior), 4),
            "recentWeight": 0.0,
            "priorWeight": 1.0,
            "priorSource": prior_source,
        }
    hits = rate * games
    blended = (hits + pseudo_games * prior) / (games + pseudo_games)
    return {
        "blendedRate": round(_clamp_probability(blended), 4),
        "recentWeight": round(games / (games + pseudo_games), 4),
        "priorWeight": round(pseudo_games / (games + pseudo_games), 4),
        "priorSource": prior_source,
    }


def apply_matchup_shift(
    probability: float,
    matchup_factor: float | None,
    *,
    weight: float = MATCHUP_LOGIT_WEIGHT,
) -> dict[str, Any]:
    factor = _float_or_none(matchup_factor)
    base = _clamp_probability(probability)
    if factor is None or abs(factor - 0.5) < 1e-9:
        return {"probability": round(base, 4), "logitShift": 0.0}
    shift = weight * (factor - 0.5)
    shifted = _sigmoid(_logit(base) + shift)
    return {"probability": round(_clamp_probability(shifted), 4), "logitShift": round(shift, 4)}


def apply_calibration_correction(
    probability: float,
    correction: dict[str, Any] | None,
) -> dict[str, Any]:
    """Apply a fitted per-market Platt correction, weighted by sample size."""
    base = _clamp_probability(probability)
    if not correction:
        return {"probability": round(base, 4), "applied": False}
    samples = max(0, int(_float_or_none(correction.get("samples")) or 0))
    intercept = _float_or_none(correction.get("intercept"))
    slope = _float_or_none(correction.get("slope"))
    if samples <= 0 or intercept is None or slope is None:
        return {"probability": round(base, 4), "applied": False}
    corrected = _sigmoid(intercept + slope * _logit(base))
    weight = samples / (samples + CALIBRATION_FULL_WEIGHT_SAMPLES)
    final = (1.0 - weight) * base + weight * corrected
    return {
        "probability": round(_clamp_probability(final), 4),
        "applied": True,
        "samples": samples,
        "weight": round(weight, 4),
        "rawCorrected": round(corrected, 4),
    }


def estimate_side_probability(
    *,
    season_mean: float | None,
    line: float | None,
    side: str,
    market_key: Any,
    recent_rate: float | None,
    recent_games: int | None,
    matchup_factor: float | None,
    calibration: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Full pre-penalty estimate pipeline for one leg.

    distributional season estimate -> EB shrinkage with recent rate ->
    matchup logit shift -> learned calibration correction.
    """
    distributional = distributional_line_probability(
        season_mean,
        line,
        side,
        market_key=market_key,
    )
    prior = distributional["winProbability"] if distributional else None
    shrunk = shrink_recent_rate(recent_rate, recent_games, prior)
    if shrunk is None:
        return None
    matchup = apply_matchup_shift(shrunk["blendedRate"], matchup_factor)
    calibrated = apply_calibration_correction(matchup["probability"], calibration)
    return {
        "estimatedProbability": calibrated["probability"],
        "distributional": distributional,
        "shrinkage": shrunk,
        "matchupShift": matchup,
        "calibration": calibrated,
        "formula": (
            "negative-binomial season estimate -> empirical-Bayes blend with "
            "recent line-clearing rate -> matchup logit shift -> graded-pick "
            "calibration correction"
        ),
    }


def get_active_calibrations(*, force_reload: bool = False) -> dict[str, dict[str, Any]]:
    """Load fitted per-market corrections from the pick ledger, cached.

    Returns an empty mapping when no ledger or no fitted corrections
    exist, which leaves probabilities untouched.
    """
    if os.getenv("OCLAY_DISABLE_CALIBRATION", "").strip().lower() in {"1", "true", "yes"}:
        return {}
    now = time.monotonic()
    if not force_reload and now - _calibration_cache["loadedAt"] < _CALIBRATION_CACHE_SECONDS:
        return dict(_calibration_cache["corrections"])
    corrections: dict[str, dict[str, Any]] = {}
    try:
        from .pick_ledger import PickLedger

        corrections = PickLedger().load_calibrations()
    except Exception:
        corrections = {}
    _calibration_cache["loadedAt"] = now
    _calibration_cache["corrections"] = corrections
    return dict(corrections)


def get_active_market_policies(*, force_reload: bool = False) -> dict[str, dict[str, Any]]:
    """Load per-market kill-switch policies from the ledger, cached.

    Returns an empty mapping when no ledger or no policies exist, which leaves
    every market enabled.
    """
    if os.getenv("OCLAY_DISABLE_MARKET_POLICY", "").strip().lower() in {"1", "true", "yes"}:
        return {}
    now = time.monotonic()
    if not force_reload and now - _market_policy_cache["loadedAt"] < _CALIBRATION_CACHE_SECONDS:
        return dict(_market_policy_cache["policies"])
    policies: dict[str, dict[str, Any]] = {}
    try:
        from .pick_ledger import PickLedger

        policies = PickLedger().load_market_policies()
    except Exception:
        policies = {}
    _market_policy_cache["loadedAt"] = now
    _market_policy_cache["policies"] = policies
    return dict(policies)


def invalidate_calibration_cache() -> None:
    _calibration_cache["loadedAt"] = 0.0
    _calibration_cache["corrections"] = {}
    _market_policy_cache["loadedAt"] = 0.0
    _market_policy_cache["policies"] = {}


def _logit(probability: float) -> float:
    p = _clamp_probability(probability)
    return math.log(p / (1.0 - p))


def _sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-value)
        return 1.0 / (1.0 + z)
    z = math.exp(value)
    return z / (1.0 + z)


def _clamp_probability(value: float) -> float:
    return max(_PROBABILITY_FLOOR, min(_PROBABILITY_CEILING, float(value)))


def _float_or_none(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
