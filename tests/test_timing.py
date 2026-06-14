from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.timing import build_timing_plan, games_from_mlb_schedule


NOW = datetime(2026, 5, 8, 18, 0, 0, tzinfo=timezone.utc)


def test_lineup_window_flags_games_2_to_4_hours_out():
    games = [{"fixtureSlug": "c-d", "startTime": int((NOW + timedelta(minutes=150)).timestamp() * 1000)}]
    plan = build_timing_plan(games, now=NOW)
    assert [g["fixtureSlug"] for g in plan["lineupWindow"]] == ["c-d"]
    assert plan["lineupWindow"][0]["action"] == "rescan_board_for_lineup_moves"


def test_started_game_is_not_due():
    games = [{"fixtureSlug": "g-h", "startTime": (NOW - timedelta(minutes=30)).isoformat()}]
    plan = build_timing_plan(games, now=NOW)
    assert plan["lineupWindow"] == []


def test_game_too_close_to_first_pitch_is_not_in_lineup_window():
    # 20 minutes out is past the lineup window (90-240) -> not flagged.
    games = [{"fixtureSlug": "a-b", "startTime": (NOW + timedelta(minutes=20)).isoformat()}]
    plan = build_timing_plan(games, now=NOW)
    assert plan["lineupWindow"] == []


def test_epoch_milliseconds_parsing():
    start_ms = int((NOW + timedelta(minutes=150)).timestamp() * 1000)
    games = [{"fixtureSlug": "x-y", "startTime": start_ms}]
    plan = build_timing_plan(games, now=NOW)
    assert plan["lineupWindow"][0]["fixtureSlug"] == "x-y"


def test_mlb_schedule_adapter_builds_fixture_slugs():
    schedule = {
        "games": [
            {
                "awayTeam": {"key": "reds"},
                "homeTeam": {"key": "astros"},
                "gameDate": (NOW + timedelta(minutes=150)).isoformat(),
            }
        ]
    }
    games = games_from_mlb_schedule(schedule)
    plan = build_timing_plan(games, now=NOW)
    assert plan["lineupWindow"][0]["fixtureSlug"] == "reds-astros"
