"""Correlation + slip expected-value model.

Same-game parlay legs are not independent, yet the old builder multiplied
odds toward a target and never multiplied probabilities at all, and the
`correlationPenalty` it consumed was never set by anything. This module
fixes both:

1. A pairwise correlation heuristic over leg pairs (same player, same
   team scoring environment, pitcher-vs-opposing-hitter, market family,
   direction).

2. A single-factor Gaussian copula (the Vasicek model from credit risk)
   that turns per-leg win probabilities plus an effective correlation
   into a genuine joint slip win probability. As correlation -> 0 it
   recovers the independence product; as correlation -> 1 it approaches
   the weakest leg. That is exactly the behavior a parlay needs.

3. Slip expected value, computed against the real payout odds, so the
   builder can compare "fewer strong legs" against "more weak legs" on
   money rather than on a heuristic score.

All math is pure Python (normal CDF via erf, inverse-normal via a
rational approximation); no numpy/scipy dependency.
"""

from __future__ import annotations

import math
from typing import Any

from .mlb_props import slug_key


# Market families that move together for a single batter.
_BATTER_VOLUME_MARKETS = {
    "hits",
    "total_bases",
    "singles",
    "runs",
    "rbi",
    "hits_runs_rbis",
    "home_runs",
}
_BATTER_DISCIPLINE_MARKETS = {"batter_walks", "batter_strikeouts"}
_PITCHER_SUPPRESSION_MARKETS = {
    "strikeouts",
    "pitcher_strikeouts",
    "hits_allowed",
    "earned_runs",
    "walks_allowed",
    "outs_recorded",
}

# Latent correlation priors per pair category. These are deliberately
# conservative; once the ledger has enough graded co-occurring legs, the
# measured phi coefficient per category blends in (see correlation_calibration).
_CATEGORY_PRIOR: dict[str, float] = {
    "different_game": 0.0,
    "same_player_same_family_same_dir": 0.62,
    "same_player_same_family_opp_dir": -0.55,
    "same_player_cross_family_same_dir": 0.20,
    "same_player_cross_family_opp_dir": -0.20,
    "pitcher_vs_hitter_aligned": 0.28,
    "pitcher_vs_hitter_opposed": -0.28,
    "same_team_offense_same_dir": 0.18,
    "same_team_offense_opp_dir": -0.18,
    "same_game_default_same_dir": 0.05,
    "same_game_default_opp_dir": 0.0,
}

# Pseudo-pairs for shrinking a measured category correlation toward its prior.
_CORRELATION_SHRINKAGE_PSEUDO_PAIRS = 40.0

_MAX_EFFECTIVE_RHO = 0.95
# Grid resolution for integrating over the common factor M ~ N(0, 1).
_FACTOR_GRID_POINTS = 200
_FACTOR_GRID_LIMIT = 7.0


def leg_pair_category(leg_a: dict[str, Any], leg_b: dict[str, Any]) -> str:
    """Classify a leg pair into a correlation category.

    The same categories are used to look up the prior and to bucket measured
    co-hit outcomes, so priors and measurements stay aligned.
    """
    if _fixture(leg_a) != _fixture(leg_b) or not _fixture(leg_a):
        return "different_game"

    player_a, player_b = _player(leg_a), _player(leg_b)
    team_a, team_b = _team(leg_a), _team(leg_b)
    market_a, market_b = _market(leg_a), _market(leg_b)
    side_a, side_b = _side(leg_a), _side(leg_b)
    direction = "same_dir" if side_a == side_b else "opp_dir"

    if player_a and player_a == player_b:
        fam_a, fam_b = _family(market_a), _family(market_b)
        if fam_a == fam_b and fam_a is not None:
            return f"same_player_same_family_{direction}"
        return f"same_player_cross_family_{direction}"

    pitcher_category = _pitcher_vs_hitter_category(
        market_a, side_a, team_a, market_b, side_b, team_b
    )
    if pitcher_category is not None:
        return pitcher_category

    if (
        team_a
        and team_a == team_b
        and _family(market_a) == "batter_volume"
        and _family(market_b) == "batter_volume"
    ):
        return f"same_team_offense_{direction}"

    return f"same_game_default_{direction}"


def leg_pair_correlation(leg_a: dict[str, Any], leg_b: dict[str, Any]) -> float:
    """Estimated latent correlation between two legs in (-1, 1).

    Uses the category prior, blended toward the measured phi coefficient when
    the ledger has enough graded pairs in that category. Legs in different
    games are treated as independent.
    """
    category = leg_pair_category(leg_a, leg_b)
    return correlation_for_category(category)


def correlation_for_category(category: str) -> float:
    prior = _CATEGORY_PRIOR.get(category, 0.0)
    measured = _get_measured_estimates().get(category)
    if not measured:
        return prior
    samples = float(measured.get("samples") or 0)
    rho = measured.get("rho")
    if rho is None or samples <= 0:
        return prior
    weight = samples / (samples + _CORRELATION_SHRINKAGE_PSEUDO_PAIRS)
    return round((1.0 - weight) * prior + weight * float(rho), 4)


def _get_measured_estimates() -> dict[str, dict[str, Any]]:
    try:
        from .correlation_calibration import get_active_correlation_estimates

        return get_active_correlation_estimates()
    except Exception:
        return {}


def slip_correlation_summary(legs: list[dict[str, Any]]) -> dict[str, Any]:
    pairs: list[dict[str, Any]] = []
    rhos: list[float] = []
    for i in range(len(legs)):
        for j in range(i + 1, len(legs)):
            rho = leg_pair_correlation(legs[i], legs[j])
            if abs(rho) < 1e-9:
                continue
            rhos.append(rho)
            pairs.append(
                {
                    "legs": [i, j],
                    "players": [_player(legs[i]), _player(legs[j])],
                    "markets": [_market(legs[i]), _market(legs[j])],
                    "correlation": round(rho, 3),
                }
            )
    mean_rho = sum(rhos) / len(rhos) if rhos else 0.0
    return {
        "meanPairwiseCorrelation": round(mean_rho, 4),
        "correlatedPairCount": len(pairs),
        "pairs": pairs,
    }


def slip_probability_and_ev(legs: list[dict[str, Any]]) -> dict[str, Any]:
    """Joint win probability and EV for a list of legs.

    Each leg should carry `winProbability` (fair, calibrated) and `odds`.
    Legs missing a probability are excluded from the probability estimate
    but still flagged so the caller knows coverage is partial.
    """
    priced = [
        leg
        for leg in legs
        if _win_probability(leg) is not None and _odds(leg) is not None
    ]
    probs = [_win_probability(leg) for leg in priced]
    odds = [_odds(leg) for leg in priced]
    product_odds = math.prod(odds) if odds else 0.0
    independence = math.prod(probs) if probs else 0.0

    correlation = slip_correlation_summary(legs)
    effective_rho = max(0.0, min(_MAX_EFFECTIVE_RHO, correlation["meanPairwiseCorrelation"]))
    joint = _single_factor_joint_probability(probs, effective_rho) if probs else 0.0

    expected_value = joint * (product_odds - 1.0) - (1.0 - joint) if probs else None
    independence_ev = (
        independence * (product_odds - 1.0) - (1.0 - independence) if probs else None
    )
    return {
        "legCount": len(legs),
        "pricedLegCount": len(priced),
        "rawProductOdds": round(product_odds, 4) if product_odds else 0.0,
        "independenceWinProbability": round(independence, 4) if probs else None,
        "estimatedWinProbability": round(joint, 4) if probs else None,
        "correlationLift": round(joint - independence, 4) if probs else None,
        "expectedValue": round(expected_value, 4) if expected_value is not None else None,
        "independenceExpectedValue": round(independence_ev, 4)
        if independence_ev is not None
        else None,
        "expectedValuePerUnit": round(expected_value, 4) if expected_value is not None else None,
        "effectiveCorrelation": round(effective_rho, 4),
        "correlation": correlation,
        "fullyPriced": len(priced) == len(legs) and bool(legs),
        "method": "single_factor_gaussian_copula",
    }


def leg_correlation_penalty(
    leg: dict[str, Any],
    higher_merit_legs: list[dict[str, Any]],
    *,
    scale: float = 14.0,
) -> dict[str, Any]:
    """Score penalty for a leg that is redundant with stronger legs.

    Stake reprices correlated SGM legs downward through betFactor, so a
    second highly-correlated leg from the same player adds little real
    payout. The penalty is proportional to the strongest positive
    correlation with an already-higher-merit leg in the same game.
    """
    max_rho = 0.0
    driver: dict[str, Any] | None = None
    for other in higher_merit_legs:
        rho = leg_pair_correlation(leg, other)
        if rho > max_rho:
            max_rho = rho
            driver = other
    penalty = round(scale * max_rho, 4)
    return {
        "penalty": penalty,
        "maxCorrelation": round(max_rho, 4),
        "driverPlayer": _player(driver) if driver else None,
        "driverMarket": _market(driver) if driver else None,
    }


# ----------------------------------------------------------------------
# Single-factor Gaussian copula
# ----------------------------------------------------------------------
def _single_factor_joint_probability(probs: list[float], rho: float) -> float:
    """P(all legs win) under a one-factor Gaussian copula.

    win_i <=> V_i <= k_i, with k_i = Phi^-1(p_i) and
    V_i = sqrt(rho) * M + sqrt(1 - rho) * eps_i.
    Conditional on the common factor M, legs are independent, so

        P(all win) = E_M[ prod_i Phi( (k_i - sqrt(rho) M) / sqrt(1 - rho) ) ]

    evaluated by trapezoidal integration over the density of M ~ N(0, 1).
    """
    clean = [min(0.999, max(0.001, p)) for p in probs]
    if not clean:
        return 0.0
    if rho <= 1e-6:
        return math.prod(clean)
    if rho >= 1.0 - 1e-6:
        return min(clean)
    ks = [_norm_ppf(p) for p in clean]
    sqrt_rho = math.sqrt(rho)
    sqrt_one_minus = math.sqrt(1.0 - rho)

    # Integrate E_M[ prod_i Phi((k_i - sqrt(rho) M)/sqrt(1-rho)) ] against
    # the standard normal density of M with a trapezoidal grid.
    step = (2.0 * _FACTOR_GRID_LIMIT) / _FACTOR_GRID_POINTS
    total = 0.0
    density_sum = 0.0
    for index in range(_FACTOR_GRID_POINTS + 1):
        m = -_FACTOR_GRID_LIMIT + index * step
        weight = math.exp(-0.5 * m * m)
        if index in (0, _FACTOR_GRID_POINTS):
            weight *= 0.5
        conditional = 1.0
        for k in ks:
            conditional *= _norm_cdf((k - sqrt_rho * m) / sqrt_one_minus)
        total += weight * conditional
        density_sum += weight
    return max(0.0, min(1.0, total / density_sum))


def _pitcher_vs_hitter_category(
    market_a: str,
    side_a: str,
    team_a: str,
    market_b: str,
    side_b: str,
    team_b: str,
) -> str | None:
    a_is_pitcher = market_a in _PITCHER_SUPPRESSION_MARKETS
    b_is_pitcher = market_b in _PITCHER_SUPPRESSION_MARKETS
    if a_is_pitcher == b_is_pitcher:
        return None
    if team_a and team_b and team_a == team_b:
        return None  # pitcher and hitter on same team: not the suppression link
    pitcher_market = market_a if a_is_pitcher else market_b
    pitcher_side = side_a if a_is_pitcher else side_b
    hitter_market = market_b if a_is_pitcher else market_a
    hitter_side = side_b if a_is_pitcher else side_a
    if hitter_market not in _BATTER_VOLUME_MARKETS:
        return None
    # A dominant pitcher co-occurs with opposing hitters going "under".
    # Dominance reads as strikeouts "over", or suppression markets (hits
    # allowed, earned runs, ...) going "under".
    if "strikeout" in pitcher_market:
        pitcher_dominant = pitcher_side == "over"
    else:
        pitcher_dominant = pitcher_side == "under"
    aligned = (pitcher_dominant and hitter_side == "under") or (
        not pitcher_dominant and hitter_side == "over"
    )
    return "pitcher_vs_hitter_aligned" if aligned else "pitcher_vs_hitter_opposed"


def _family(market_key: str) -> str | None:
    if market_key in _BATTER_VOLUME_MARKETS:
        return "batter_volume"
    if market_key in _BATTER_DISCIPLINE_MARKETS:
        return "batter_discipline"
    if market_key in _PITCHER_SUPPRESSION_MARKETS:
        return "pitcher_suppression"
    return None


# ----------------------------------------------------------------------
# Field accessors (tolerant of both candidate-pool and slip-builder shapes)
# ----------------------------------------------------------------------
def _fixture(leg: dict[str, Any]) -> str:
    return str(leg.get("fixtureSlug") or leg.get("matchup") or "")


def _player(leg: dict[str, Any]) -> str:
    player = leg.get("player")
    if isinstance(player, dict):
        return slug_key(player.get("key") or player.get("name"))
    return slug_key(player)


def _team(leg: dict[str, Any]) -> str:
    team = leg.get("team")
    if isinstance(team, dict):
        return slug_key(team.get("key") or team.get("name"))
    return slug_key(team)


def _market(leg: dict[str, Any]) -> str:
    market = leg.get("normalizedMarketKey")
    if market:
        return str(market).replace("-", "_")
    market = leg.get("market")
    if isinstance(market, dict):
        market = market.get("key")
    return slug_key(market).replace("-", "_")


def _side(leg: dict[str, Any]) -> str:
    return str(leg.get("side") or "").lower()


def _win_probability(leg: dict[str, Any]) -> float | None:
    for key in ("winProbability", "estimatedProbability", "fairProbability"):
        value = _float_or_none(leg.get(key))
        if value is not None:
            return value
    probability = leg.get("probabilityAssessment")
    if isinstance(probability, dict):
        return _float_or_none(
            probability.get("estimatedProbability")
            or probability.get("adjustedEstimatedProbability")
        )
    return None


def _odds(leg: dict[str, Any]) -> float | None:
    value = _float_or_none(leg.get("odds"))
    if value is not None and value > 1.0:
        return value
    return None


# ----------------------------------------------------------------------
# Normal distribution helpers (pure Python)
# ----------------------------------------------------------------------
def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_ppf(p: float) -> float:
    """Inverse normal CDF via Acklam's rational approximation."""
    if p <= 0.0:
        return -8.0
    if p >= 1.0:
        return 8.0
    a = (-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00)
    b = (-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01)
    c = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00)
    d = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00)
    p_low = 0.02425
    p_high = 1.0 - p_low
    if p < p_low:
        q = math.sqrt(-2.0 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
    if p <= p_high:
        q = p - 0.5
        r = q * q
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / \
               (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0)
    q = math.sqrt(-2.0 * math.log(1.0 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)


def _float_or_none(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
