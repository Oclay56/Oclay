"""Point-in-time model validation: does OCLAY's probability tell the truth?

The realized backtest measures how the bets did. This measures whether the
*model* is calibrated -- when it says a side hits 70%, does it hit ~70%? To
avoid look-ahead, each settled pick is re-scored using only that player's games
*before* the slate date: the pre-game per-game mean feeds the same
negative-binomial line model the live engine uses, producing an honest
point-in-time probability that is compared against the real outcome.

This validates the distributional core (the heart of the estimate), not the
full enrichment pipeline -- matchup and learned calibration are intentionally
left out so the check is clean and reproducible from the box score alone.

It needs MLB game logs, so it makes network calls and is meant to be run
occasionally, not on every request. Picks whose player cannot be resolved or
that lack enough prior games are reported as coverage gaps, never guessed.
"""

from __future__ import annotations

from typing import Any

from .mlb_bridge import stat_mapping_for_market, stat_value_from_stats
from .mlb_props import slug_key
from .pick_ledger import GRADE_LOSS, GRADE_WIN, PickLedger
from .probability_engine import distributional_line_probability

RELIABILITY_BUCKETS = 10
DEFAULT_MIN_PRIOR_GAMES = 3
DEFAULT_HISTORY_LIMIT = 100


async def run_model_backtest(
    engine: Any,
    *,
    ledger: PickLedger | None = None,
    min_prior_games: int = DEFAULT_MIN_PRIOR_GAMES,
) -> dict[str, Any]:
    """Re-score settled picks point-in-time and grade the model's calibration."""
    ledger = ledger or PickLedger()
    picks = [
        p
        for p in ledger.settled_picks()
        if p.get("outcome") in {GRADE_WIN, GRADE_LOSS}
    ]
    considered = len(picks)
    scored: list[tuple[float, int]] = []
    unresolved_player = 0
    insufficient_history = 0
    unmappable_market = 0

    person_cache: dict[str, int | None] = {}
    history_cache: dict[tuple[int, str, int | None], dict[str, Any]] = {}

    for pick in picks:
        result = await _score_one(
            engine,
            pick,
            min_prior_games=min_prior_games,
            person_cache=person_cache,
            history_cache=history_cache,
        )
        if result == "unmappable":
            unmappable_market += 1
        elif result == "unresolved":
            unresolved_player += 1
        elif result == "insufficient":
            insufficient_history += 1
        elif isinstance(result, tuple):
            scored.append(result)

    return {
        "purpose": "oclay_point_in_time_model_backtest",
        "consideredPicks": considered,
        "scoredPicks": len(scored),
        "coverageGaps": {
            "unresolvedPlayer": unresolved_player,
            "insufficientPriorGames": insufficient_history,
            "unmappableMarket": unmappable_market,
        },
        **_calibration(scored),
    }


async def _score_one(
    engine: Any,
    pick: dict[str, Any],
    *,
    min_prior_games: int,
    person_cache: dict[str, int | None],
    history_cache: dict[tuple[int, str, int | None], dict[str, Any]],
) -> Any:
    line = _float(pick.get("line"))
    side = str(pick.get("side") or "").lower()
    slate_date = str(pick.get("slate_date") or "")
    market_key = str(pick.get("market_key") or "")
    if line is None or side not in {"over", "under"} or not slate_date:
        return "insufficient"

    mapping = stat_mapping_for_market(market_key)
    if not mapping.get("statKey") and not mapping.get("statFormula"):
        return "unmappable"
    group = str(mapping.get("group") or "hitting")
    season = _season_from_date(slate_date)

    person_id = await _resolve_person_id(engine, pick, person_cache)
    if person_id is None:
        return "unresolved"

    cache_key = (person_id, group, season)
    history = history_cache.get(cache_key)
    if history is None:
        try:
            history = await engine.get_player_recent_history(
                person_id, group=group, season=season, limit=DEFAULT_HISTORY_LIMIT
            )
        except Exception:
            history = {}
        history_cache[cache_key] = history or {}

    mean = _point_in_time_mean(history, mapping, slate_date, min_prior_games)
    if mean is None:
        return "insufficient"

    estimate = distributional_line_probability(mean, line, side, market_key=market_key)
    if estimate is None:
        return "insufficient"

    probability = float(estimate["winProbability"])
    outcome = 1 if pick.get("outcome") == GRADE_WIN else 0
    return (probability, outcome)


async def _resolve_person_id(
    engine: Any,
    pick: dict[str, Any],
    person_cache: dict[str, int | None],
) -> int | None:
    person_id = _int(pick.get("mlb_person_id"))
    if person_id is not None:
        return person_id
    name = str(pick.get("player") or "").strip()
    if not name:
        return None
    key = slug_key(name)
    if key in person_cache:
        return person_cache[key]
    resolved: int | None = None
    try:
        found = await engine.search_players(name, limit=5)
        for player in found.get("players") or []:
            if slug_key(player.get("name")) == key:
                resolved = _int(player.get("mlbId"))
                break
        if resolved is None:
            players = found.get("players") or []
            if players:
                resolved = _int(players[0].get("mlbId"))
    except Exception:
        resolved = None
    person_cache[key] = resolved
    return resolved


def _point_in_time_mean(
    history: dict[str, Any],
    mapping: dict[str, Any],
    slate_date: str,
    min_prior_games: int,
) -> float | None:
    target = slate_date[:10]
    stat_ref: Any = mapping if mapping.get("statFormula") else mapping.get("statKey")
    values: list[float] = []
    for game in (history or {}).get("games") or []:
        if str(game.get("date") or "")[:10] >= target:
            continue  # only games strictly before the slate date
        value = stat_value_from_stats(stat_ref, game.get("stats") or {})
        if value is not None:
            values.append(float(value))
    if len(values) < max(1, min_prior_games):
        return None
    return sum(values) / len(values)


def _calibration(scored: list[tuple[float, int]]) -> dict[str, Any]:
    if not scored:
        return {
            "status": "no_scoreable_history",
            "note": "No settled picks could be re-scored point-in-time yet.",
        }
    brier = 0.0
    wins = 0
    buckets = [{"n": 0.0, "predicted": 0.0, "wins": 0.0} for _ in range(RELIABILITY_BUCKETS)]
    for probability, outcome in scored:
        p = min(1.0, max(0.0, probability))
        brier += (p - outcome) ** 2
        wins += outcome
        idx = min(RELIABILITY_BUCKETS - 1, int(p * RELIABILITY_BUCKETS))
        buckets[idx]["n"] += 1
        buckets[idx]["predicted"] += p
        buckets[idx]["wins"] += outcome

    n = len(scored)
    curve = []
    for i, b in enumerate(buckets):
        if b["n"] == 0:
            continue
        curve.append(
            {
                "bucket": f"{i / RELIABILITY_BUCKETS:.1f}-{(i + 1) / RELIABILITY_BUCKETS:.1f}",
                "picks": int(b["n"]),
                "meanPredicted": round(b["predicted"] / b["n"], 4),
                "actualHitRate": round(b["wins"] / b["n"], 4),
            }
        )
    mean_pred = sum(p for p, _ in scored) / n
    return {
        "status": "ok",
        "brierScore": round(brier / n, 4),
        "meanPredicted": round(mean_pred, 4),
        "actualHitRate": round(wins / n, 4),
        "calibrationError": round(abs(mean_pred - wins / n), 4),
        "reliabilityCurve": curve,
    }


def _season_from_date(slate_date: str) -> int | None:
    try:
        return int(slate_date[:4])
    except (TypeError, ValueError):
        return None


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
