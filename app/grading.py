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

from datetime import date
from typing import Any

from .market_normalization import is_optional_sequence_market
from .mlb_bridge import stat_mapping_for_market, stat_value_from_stats
from .mlb_props import slug_key
from .pick_ledger import GRADE_LOSS, GRADE_PUSH, GRADE_VOID, GRADE_WIN, PickLedger
from .player_backfill import resolve_person_id


# Why a pending pick was not graded this run. "Waiting" reasons resolve on their
# own once box scores post; the rest need a fix and will never settle as-is.
REASON_NO_GAME = "no_game_yet"
REASON_NO_STAT = "no_stat_yet"
REASON_FETCH = "fetch_error"
REASON_INVALID = "invalid_pick"
REASON_NO_PLAYER = "no_player_id"
REASON_UNMAPPED = "unmapped_market"
REASON_SEQUENCE = "sequence_market_pending_grader"

_WAITING_REASONS = {REASON_NO_GAME, REASON_NO_STAT, REASON_FETCH}

# A "waiting" pick whose game was this many days ago (or more) almost never
# settles on its own -- it's usually a name/ID or data mismatch, not a real
# wait -- so it gets promoted to "needs attention" instead of waiting forever.
STALE_AFTER_DAYS = 2

_REASON_TEXT = {
    REASON_NO_GAME: "box score not posted yet",
    REASON_NO_STAT: "stat not in the box score yet",
    REASON_FETCH: "stats fetch failed (will retry)",
    REASON_INVALID: "incomplete pick data (line/side/date)",
    REASON_NO_PLAYER: "player not matched to an MLB id",
    REASON_UNMAPPED: "market not recognized",
    REASON_SEQUENCE: "first-event market (first hit/run/HR) -- not auto-gradable yet",
}


def _days_since(slate_date: Any, today: date) -> int | None:
    try:
        return (today - date.fromisoformat(str(slate_date))).days
    except (TypeError, ValueError):
        return None


def _pending_detail(pick: dict[str, Any], reason: str, *, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    slate = pick.get("slate_date")
    category = "waiting" if reason in _WAITING_REASONS else "attention"
    reason_text = _REASON_TEXT.get(reason, reason)

    # Aging: a "waiting" pick whose game is days old is almost certainly stuck,
    # not pending -- promote it so it stops hiding in the waiting list.
    age = _days_since(slate, today)
    if category == "waiting" and age is not None and age >= STALE_AFTER_DAYS:
        category = "attention"
        reason_text = f"still unsettled after {age} days - likely a name/ID or data mismatch"

    return {
        "player": pick.get("player") or "(unknown player)",
        "market": pick.get("market_key"),
        "side": pick.get("side"),
        "line": pick.get("line"),
        "slateDate": slate,
        "team": pick.get("team"),
        "fixture": pick.get("fixture_slug"),
        "reason": reason_text,
        "category": category,
    }


async def grade_pending_picks(
    engine: Any,
    *,
    ledger: PickLedger | None = None,
    slate_date: str | None = None,
    history_limit: int = 25,
    today: date | None = None,
) -> dict[str, Any]:
    """Grade every pending pick that has an identifiable MLB outcome.

    Returns a settlement report. Picks whose player or game cannot be
    resolved are left pending (not voided) so a later run can retry once
    the box score is final.
    """
    ledger = ledger or PickLedger()
    pending = ledger.pending_picks(slate_date=slate_date)
    gradable, waiting_on, needs_attention = await _classify_pending(
        engine, pending, history_limit=history_limit, persist_ledger=ledger, today=today
    )

    graded = 0
    outcomes: dict[str, int] = {GRADE_WIN: 0, GRADE_LOSS: 0, GRADE_PUSH: 0, GRADE_VOID: 0}
    for pick, outcome, actual_value in gradable:
        if ledger.apply_grade(pick["pick_key"], outcome=outcome, actual_value=actual_value):
            graded += 1
            outcomes[outcome] = outcomes.get(outcome, 0) + 1

    await _attach_game_status(engine, waiting_on)
    slip_settlement = ledger.settle_slips()
    return {
        "pendingConsidered": len(pending),
        "graded": graded,
        "skippedUnresolved": len(waiting_on) + len(needs_attention),
        "outcomes": outcomes,
        "slips": slip_settlement,
        "slateDate": slate_date,
        "waitingOn": waiting_on,
        "needsAttention": needs_attention,
    }


async def diagnose_pending_picks(
    engine: Any,
    *,
    ledger: PickLedger | None = None,
    slate_date: str | None = None,
    history_limit: int = 25,
    today: date | None = None,
) -> dict[str, Any]:
    """Read-only: classify pending picks into waiting/attention without grading.

    Used by the Honest report so it can show which logged picks are still
    missing from calibration, and why, without mutating the ledger.
    """
    ledger = ledger or PickLedger()
    pending = ledger.pending_picks(slate_date=slate_date)
    gradable, waiting_on, needs_attention = await _classify_pending(
        engine, pending, history_limit=history_limit, persist_ledger=None, today=today
    )
    await _attach_game_status(engine, waiting_on)
    return {
        "pendingConsidered": len(pending),
        "gradableNow": len(gradable),
        "waitingOn": waiting_on,
        "needsAttention": needs_attention,
    }


async def _classify_pending(
    engine: Any,
    pending: list[dict[str, Any]],
    *,
    history_limit: int,
    persist_ledger: PickLedger | None,
    today: date | None,
) -> tuple[list[tuple[dict[str, Any], str, float | None]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Run each pending pick through the grader, sorting into gradable now /
    waiting on stats / needs attention. Applies no grades (caller decides)."""
    gradable: list[tuple[dict[str, Any], str, float | None]] = []
    waiting_on: list[dict[str, Any]] = []
    needs_attention: list[dict[str, Any]] = []
    game_log_cache: dict[tuple[int, str, int | None], dict[str, Any]] = {}
    person_cache: dict[str, int | None] = {}

    for pick in pending:
        status, payload = await _grade_one(
            engine,
            pick,
            history_limit=history_limit,
            game_log_cache=game_log_cache,
            person_cache=person_cache,
            ledger=persist_ledger,
        )
        if status == "graded":
            outcome, actual_value = payload
            gradable.append((pick, outcome, actual_value))
            continue
        detail = _pending_detail(pick, payload, today=today)
        if detail["category"] == "waiting":
            waiting_on.append(detail)
        else:
            needs_attention.append(detail)
    return gradable, waiting_on, needs_attention


def _inning_label(inning: dict[str, Any] | None) -> str:
    if not inning:
        return ""
    state = str(inning.get("state") or "").strip()
    ordinal = str(inning.get("ordinal") or "").strip()
    if state and ordinal:
        return f"{state} {ordinal}"
    return ordinal or state


def _game_state_reason(game: dict[str, Any]) -> str | None:
    status = game.get("status")
    s = (status or "").lower()
    if not s:
        return None
    if any(k in s for k in ("final", "game over", "completed")):
        return "game final - box score posting"
    if any(k in s for k in ("progress", "delayed", "challenge", "review", "warmup")):
        label = _inning_label(game.get("inning"))
        return f"game in progress ({label})" if label else "game in progress"
    if any(k in s for k in ("scheduled", "pre-game", "pre game")):
        return "game hasn't started yet"
    if any(k in s for k in ("postponed", "suspended", "cancel")):
        return f"game {s}"
    return None


def _match_schedule_game(games: list[dict[str, Any]], item: dict[str, Any]) -> dict[str, Any] | None:
    fixture = str(item.get("fixture") or "")
    team_key = slug_key(str(item.get("team") or "")) if item.get("team") else ""
    for game in games:
        home = (game.get("homeTeam") or {}).get("key") or ""
        away = (game.get("awayTeam") or {}).get("key") or ""
        if home and away and home in fixture and away in fixture:
            return game
        if team_key and team_key in (home, away):
            return game
    return None


async def _attach_game_status(engine: Any, items: list[dict[str, Any]]) -> None:
    """Best-effort: tag each waiting pick with its game's live state (in progress
    / final / not started). Never raises -- if the schedule can't be read, the
    generic 'box score not posted yet' reason stands."""
    if not items or not hasattr(engine, "get_schedule"):
        return
    by_date: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        slate = item.get("slateDate")
        if slate:
            by_date.setdefault(str(slate), []).append(item)
    for slate, group in by_date.items():
        try:
            schedule = await engine.get_schedule(slate)
        except Exception:
            continue
        games = schedule.get("games") or []
        for item in group:
            game = _match_schedule_game(games, item)
            if not game:
                continue
            reason = _game_state_reason(game)
            if reason:
                item["gameStatus"] = game.get("status")
                item["reason"] = reason


async def _grade_one(
    engine: Any,
    pick: dict[str, Any],
    *,
    history_limit: int,
    game_log_cache: dict[tuple[int, str, int | None], dict[str, Any]],
    person_cache: dict[str, int | None] | None = None,
    ledger: PickLedger | None = None,
) -> tuple[str, Any]:
    """Returns ("graded", (outcome, value)) or ("skip", reason_code)."""
    line = _float_or_none(pick.get("line"))
    side = str(pick.get("side") or "").lower()
    slate_date = str(pick.get("slate_date") or "")
    if line is None or side not in {"over", "under"} or not slate_date:
        return ("skip", REASON_INVALID)

    person_id = _int_or_none(pick.get("mlb_person_id"))
    if person_id is None:
        # Backup only: a logged leg that arrived without its MLB id (e.g. the
        # GPT omitted it) is resolved from the player name. This never runs on
        # the normal path -- a pick that already has its id skips this entirely.
        person_id = await _resolve_person_id_by_name(engine, pick.get("player"), person_cache)
        # Save the resolved id back so this leg (and others for the same player)
        # never needs a name lookup again -- the chore becomes one-time.
        if person_id is not None and ledger is not None and pick.get("player"):
            try:
                ledger.set_person_id_for_player(str(pick["player"]), person_id)
            except Exception:
                pass
    if person_id is None:
        return ("skip", REASON_NO_PLAYER)

    market_key = str(pick.get("market_key") or "")
    if is_optional_sequence_market(market_key):
        # First-event market: never settle it against a counting-stat total.
        # It needs a play-by-play grader; until then it is held, not misgraded.
        return ("skip", REASON_SEQUENCE)
    mapping = stat_mapping_for_market(market_key)
    if not mapping.get("statKey") and not mapping.get("statFormula"):
        return ("skip", REASON_UNMAPPED)
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
            return ("skip", REASON_FETCH)
        game_log_cache[cache_key] = history or {}

    game = _game_on_date(history, slate_date)
    if game is None:
        return ("skip", REASON_NO_GAME)

    stat_ref: Any = mapping if mapping.get("statFormula") else mapping.get("statKey")
    actual = stat_value_from_stats(stat_ref, game.get("stats") or {})
    if actual is None:
        return ("skip", REASON_NO_STAT)

    return ("graded", (_settle(actual, line, side), actual))


async def _resolve_person_id_by_name(
    engine: Any,
    name: Any,
    person_cache: dict[str, int | None] | None,
) -> int | None:
    """Best-effort name -> MLB id, cached per run. Never raises into grading."""
    clean = str(name or "").strip()
    if not clean:
        return None
    key = slug_key(clean)
    if person_cache is not None and key in person_cache:
        return person_cache[key]
    try:
        person_id = await resolve_person_id(engine, clean)
    except Exception:
        person_id = None
    if person_cache is not None:
        person_cache[key] = person_id
    return person_id


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
