"""EV-maximizing slip construction.

The greedy odds-target builder chases a payout number. This optimizer chases
money: it adds the leg that most increases the slip's correlation-aware
expected value, and stops at the EV peak (or when the slip win probability
would fall through a floor). That naturally produces the "fewer strong legs
beat more weak ones" discipline instead of relying on the GPT to enforce it.

EV and joint win probability come from the single-factor copula in
app.correlation, so correlation between legs is priced in, not ignored.
"""

from __future__ import annotations

from typing import Any

from .correlation import slip_probability_and_ev
from .mlb_props import slug_key


def build_ev_max_slip(
    legs: list[dict[str, Any]],
    *,
    min_legs: int = 2,
    max_legs: int = 8,
    max_product_odds: float = 501.0,
    min_win_probability: float = 0.03,
    one_leg_per_player: bool = True,
) -> dict[str, Any]:
    """Greedily assemble the expected-value-maximizing slip.

    At each step the leg that yields the highest slip EV is added, as long as
    it increases EV and keeps the slip win probability at or above the floor
    and product odds under the cap. The per-leg EV curve is returned so the
    peak is visible.
    """
    eligible = _eligible_legs(legs, one_leg_per_player=one_leg_per_player)
    selected: list[dict[str, Any]] = []
    used_players: set[str] = set()
    ev_curve: list[dict[str, Any]] = []
    best_snapshot: dict[str, Any] | None = None

    while len(selected) < max_legs:
        candidate = _best_addition(
            selected,
            eligible,
            used_players,
            max_product_odds=max_product_odds,
            min_win_probability=min_win_probability,
            one_leg_per_player=one_leg_per_player,
        )
        if candidate is None:
            break
        leg, projection = candidate
        current_ev = best_snapshot["expectedValue"] if best_snapshot else None
        next_ev = projection["expectedValue"]
        # Keep growing only while EV strictly improves once past the minimum.
        if (
            len(selected) >= min_legs
            and current_ev is not None
            and next_ev is not None
            and next_ev <= current_ev
        ):
            break
        selected.append(leg)
        if one_leg_per_player:
            used_players.add(_player_key(leg))
        best_snapshot = projection
        ev_curve.append(
            {
                "legCount": len(selected),
                "addedPlayer": leg.get("player"),
                "addedMarket": _market(leg),
                "expectedValue": next_ev,
                "winProbability": projection["estimatedWinProbability"],
                "productOdds": projection["rawProductOdds"],
            }
        )

    projection = best_snapshot or slip_probability_and_ev(selected)
    meets_minimum = len(selected) >= min_legs
    return {
        "mode": "ev_max",
        "legCount": len(selected),
        "meetsMinimumLegs": meets_minimum,
        "legs": selected,
        "expectedValue": projection.get("expectedValue"),
        "estimatedWinProbability": projection.get("estimatedWinProbability"),
        "rawProductOdds": projection.get("rawProductOdds"),
        "correlationLift": projection.get("correlationLift"),
        "evCurve": ev_curve,
        "stoppedReason": _stopped_reason(selected, ev_curve, max_legs),
        "note": (
            "Legs were added while slip expected value increased and win "
            "probability stayed above the floor; this is modeled EV, not a "
            "final Stake SGM quote."
        ),
    }


def _best_addition(
    selected: list[dict[str, Any]],
    eligible: list[dict[str, Any]],
    used_players: set[str],
    *,
    max_product_odds: float,
    min_win_probability: float,
    one_leg_per_player: bool,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    best: tuple[dict[str, Any], dict[str, Any]] | None = None
    best_ev = None
    selected_ids = {id(leg) for leg in selected}
    for leg in eligible:
        if id(leg) in selected_ids:
            continue
        if one_leg_per_player and _player_key(leg) in used_players:
            continue
        trial = selected + [leg]
        projection = slip_probability_and_ev(trial)
        product_odds = projection.get("rawProductOdds") or 0.0
        win = projection.get("estimatedWinProbability")
        ev = projection.get("expectedValue")
        if ev is None or win is None:
            continue
        if product_odds > max_product_odds:
            continue
        if len(trial) >= 2 and win < min_win_probability:
            continue
        if best_ev is None or ev > best_ev:
            best_ev = ev
            best = (leg, projection)
    return best


def _eligible_legs(
    legs: list[dict[str, Any]],
    *,
    one_leg_per_player: bool,
) -> list[dict[str, Any]]:
    priced = [leg for leg in legs if _is_priced(leg)]
    if not one_leg_per_player:
        return priced
    # Keep the highest standalone-EV leg per player so the optimizer never
    # has to choose between two legs it cannot combine anyway.
    best_by_player: dict[str, dict[str, Any]] = {}
    for leg in priced:
        key = _player_key(leg)
        incumbent = best_by_player.get(key)
        if incumbent is None or _standalone_ev(leg) > _standalone_ev(incumbent):
            best_by_player[key] = leg
    return list(best_by_player.values())


def _is_priced(leg: dict[str, Any]) -> bool:
    return _win_probability(leg) is not None and _odds(leg) is not None


def _standalone_ev(leg: dict[str, Any]) -> float:
    win = _win_probability(leg) or 0.0
    odds = _odds(leg) or 1.0
    return win * (odds - 1.0) - (1.0 - win)


def _stopped_reason(
    selected: list[dict[str, Any]],
    ev_curve: list[dict[str, Any]],
    max_legs: int,
) -> str:
    if not selected:
        return "no_positive_value_legs_available"
    if len(selected) >= max_legs:
        return "reached_max_legs"
    return "expected_value_peaked"


def _player_key(leg: dict[str, Any]) -> str:
    player = leg.get("player")
    if isinstance(player, dict):
        return slug_key(player.get("key") or player.get("name"))
    return slug_key(player)


def _market(leg: dict[str, Any]) -> str:
    market = leg.get("normalizedMarketKey")
    if market:
        return str(market)
    market = leg.get("market")
    if isinstance(market, dict):
        return slug_key(market.get("key"))
    return slug_key(market)


def _win_probability(leg: dict[str, Any]) -> float | None:
    for key in ("winProbability", "estimatedProbability", "fairProbability"):
        value = _float_or_none(leg.get(key))
        if value is not None:
            return value
    probability = leg.get("probabilityAssessment")
    if isinstance(probability, dict):
        return _float_or_none(probability.get("estimatedProbability"))
    return None


def _odds(leg: dict[str, Any]) -> float | None:
    value = _float_or_none(leg.get("odds"))
    if value is not None and value > 1.0:
        return value
    return None


def _float_or_none(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
