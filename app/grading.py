"""Grading engine: settles recorded picks against real MLB outcomes.

This closes the loop. Every pending pick in the ledger names a player, a
market (which maps to an MLB stat key), a line, a side, and a slate date.
The grader pulls that player's game log, finds the game played on the
slate date, computes the actual stat value, and settles the pick
win/loss/push. Once legs are graded, slips settle from their legs and the
calibration engine can refit.

MLB volume is the asset here: ~15 games a day means hundreds of gradable
legs accumulate within days, so calibration has signal fast.
"""

from __future__ import annotations

from typing import Any

from .mlb_bridge import stat_mapping_for_market, stat_value_from_stats
from .pick_ledger import GRADE_LOSS, GRADE_PUSH, GRADE_VOID, GRADE_WIN, PickLedger


async def grade_pending_picks(
    engine: Any,
    *,
    ledger: PickLedger | None = None,
    slate_date: str | None = None,
    history_limit: int = 25,
) -> dict[str, Any]:
    """Grade every pending pick that has an identifiable MLB outcome.

    Returns a settlement report. Picks whose player or game cannot be
    resolved are left pending (not voided) so a later run can retry once
    the box score is final.
    """
    ledger = ledger or PickLedger()
    pending = ledger.pending_picks(slate_date=slate_date)
    graded = 0
    skipped = 0
    outcomes: dict[str, int] = {GRADE_WIN: 0, GRADE_LOSS: 0, GRADE_PUSH: 0, GRADE_VOID: 0}
    game_log_cache: dict[tuple[int, str, int | None], dict[str, Any]] = {}

    for pick in pending:
        result = await _grade_one(
            engine,
            pick,
            history_limit=history_limit,
            game_log_cache=game_log_cache,
        )
        if result is None:
            skipped += 1
            continue
        outcome, actual_value = result
        if ledger.apply_grade(pick["pick_key"], outcome=outcome, actual_value=actual_value):
            graded += 1
            outcomes[outcome] = outcomes.get(outcome, 0) + 1

    slip_settlement = ledger.settle_slips()
    return {
        "pendingConsidered": len(pending),
        "graded": graded,
        "skippedUnresolved": skipped,
        "outcomes": outcomes,
        "slips": slip_settlement,
        "slateDate": slate_date,
    }


async def _grade_one(
    engine: Any,
    pick: dict[str, Any],
    *,
    history_limit: int,
    game_log_cache: dict[tuple[int, str, int | None], dict[str, Any]],
) -> tuple[str, float | None] | None:
    person_id = _int_or_none(pick.get("mlb_person_id"))
    line = _float_or_none(pick.get("line"))
    side = str(pick.get("side") or "").lower()
    slate_date = str(pick.get("slate_date") or "")
    if person_id is None or line is None or side not in {"over", "under"} or not slate_date:
        return None

    mapping = stat_mapping_for_market(str(pick.get("market_key") or ""))
    if not mapping.get("statKey") and not mapping.get("statFormula"):
        return None
    group = str(mapping.get("group") or "hitting")
    season = _season_from_date(slate_date)

    cache_key = (person_id, group, season)
    history = game_log_cache.get(cache_key)
    if history is None:
        try:
            history = await engine.get_player_recent_history(
                person_id,
                group=group,
                season=season,
                limit=history_limit,
            )
        except Exception:
            return None
        game_log_cache[cache_key] = history or {}

    game = _game_on_date(history, slate_date)
    if game is None:
        return None

    stat_ref: Any = mapping if mapping.get("statFormula") else mapping.get("statKey")
    actual = stat_value_from_stats(stat_ref, game.get("stats") or {})
    if actual is None:
        return None

    return _settle(actual, line, side), actual


def _settle(actual: float, line: float, side: str) -> str:
    if abs(actual - line) < 1e-9:
        return GRADE_PUSH
    cleared = actual > line
    if side == "over":
        return GRADE_WIN if cleared else GRADE_LOSS
    return GRADE_LOSS if cleared else GRADE_WIN


def _game_on_date(history: dict[str, Any], slate_date: str) -> dict[str, Any] | None:
    target = slate_date[:10]
    for game in (history or {}).get("games") or []:
        if str(game.get("date") or "")[:10] == target:
            return game
    return None


def _season_from_date(slate_date: str) -> int | None:
    try:
        return int(slate_date[:4])
    except (TypeError, ValueError):
        return None


def _float_or_none(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
