"""Timing windows for lineup-confirmation rescans.

Lines move most in the 2-4 hours before first pitch as lineups confirm. This
module flags games inside that lineup window so a scheduler can trigger a board
rescan and catch prices that have not adjusted yet -- the input the stale-line /
latency detector keys off of.

The functions are pure (given the slate and a clock), so a cron job, the CLI,
or the API can drive them. The actual board read still flows through the
existing Stake helper; this only decides when.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


# Lineup confirmation window before first pitch.
LINEUP_WINDOW_EARLY_MINUTES = 240
LINEUP_WINDOW_LATE_MINUTES = 90


def build_timing_plan(
    games: list[dict[str, Any]],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Classify each game into the action windows it currently sits in."""
    clock = _as_utc(now) or datetime.now(timezone.utc)
    lineup_window: list[dict[str, Any]] = []
    upcoming: list[dict[str, Any]] = []

    for game in games:
        start = _game_start(game)
        if start is None:
            continue
        minutes = (start - clock).total_seconds() / 60.0
        entry = {
            "fixtureSlug": game.get("fixtureSlug") or game.get("slug"),
            "matchup": game.get("matchup") or game.get("name"),
            "startTime": start.isoformat(),
            "minutesToStart": round(minutes, 1),
        }
        if LINEUP_WINDOW_LATE_MINUTES <= minutes <= LINEUP_WINDOW_EARLY_MINUTES:
            lineup_window.append({**entry, "action": "rescan_board_for_lineup_moves"})
        elif minutes > LINEUP_WINDOW_EARLY_MINUTES:
            upcoming.append(entry)

    lineup_window.sort(key=lambda item: item["minutesToStart"])
    return {
        "purpose": "timing_plan",
        "now": clock.isoformat(),
        "windows": {
            "lineupEarlyMinutes": LINEUP_WINDOW_EARLY_MINUTES,
            "lineupLateMinutes": LINEUP_WINDOW_LATE_MINUTES,
        },
        "lineupWindow": lineup_window,
        "upcomingCount": len(upcoming),
        "note": (
            "lineupWindow games should be rescanned to catch lineup-driven line "
            "moves before first pitch -- the stale-line / latency edge."
        ),
    }


def games_from_mlb_schedule(schedule: dict[str, Any]) -> list[dict[str, Any]]:
    """Adapt an MLB schedule payload into timing game dicts."""
    games: list[dict[str, Any]] = []
    for game in schedule.get("games") or []:
        away = (game.get("awayTeam") or {}).get("key") or (game.get("awayTeam") or {}).get("name")
        home = (game.get("homeTeam") or {}).get("key") or (game.get("homeTeam") or {}).get("name")
        slug = f"{away}-{home}" if away and home else None
        games.append(
            {
                "fixtureSlug": slug,
                "matchup": game.get("matchup") or (f"{away} vs {home}" if away and home else None),
                "gameDate": game.get("gameDate") or game.get("gameDateTime"),
                "startTime": game.get("startTime"),
            }
        )
    return games


def _game_start(game: dict[str, Any]) -> datetime | None:
    for key in ("startTime", "gameDate", "gameDateTime", "date"):
        value = game.get(key)
        parsed = _parse_time(value)
        if parsed is not None:
            return parsed
    return None


def _parse_time(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _as_utc(value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        # Stake uses epoch milliseconds.
        seconds = value / 1000.0 if value > 1e11 else float(value)
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return _parse_time(int(text))
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        return _as_utc(datetime.fromisoformat(text))
    except ValueError:
        return None


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
