from __future__ import annotations

import asyncio

import app.stake_odds_fill as sof
from app.stake_odds_fill import _leg_odds_from_rows, fill_missing_leg_odds


ROWS = [
    {"player": "Shohei Ohtani", "market": "Total Bases", "line": 1.5, "over": 2.1, "under": 1.7},
    {"player": "Aaron Judge", "market": "Home Runs", "line": 0.5, "over": 3.5, "under": 1.3},
]


def test_matcher_picks_correct_side_market_and_line():
    under = {"player": "Shohei Ohtani", "normalizedMarketKey": "total_bases", "side": "under", "line": 1.5}
    over = {"player": "Shohei Ohtani", "normalizedMarketKey": "total_bases", "side": "over", "line": 1.5}
    assert _leg_odds_from_rows(ROWS, under) == 1.7
    assert _leg_odds_from_rows(ROWS, over) == 2.1

    # Wrong line, wrong market, and unknown player all miss cleanly.
    assert _leg_odds_from_rows(ROWS, {**under, "line": 2.5}) is None
    assert _leg_odds_from_rows(ROWS, {**under, "normalizedMarketKey": "hits"}) is None
    assert _leg_odds_from_rows(ROWS, {**under, "player": "Nobody"}) is None


def test_fill_only_touches_legs_missing_odds(monkeypatch):
    monkeypatch.setattr(sof, "flatten_player_prop_rows", lambda odds: ROWS)

    class FakeClient:
        def __init__(self):
            self.calls = []

        async def get_odds(self, slug):
            self.calls.append(slug)
            return {"slug": slug}

    legs = [
        {"player": "Shohei Ohtani", "normalizedMarketKey": "total_bases",
         "side": "under", "line": 1.5, "fixtureSlug": "f1"},          # missing -> fill 1.7
        {"player": "Aaron Judge", "normalizedMarketKey": "home_runs",
         "side": "over", "line": 0.5, "odds": 4.0, "fixtureSlug": "f1"},  # already priced
    ]
    client = FakeClient()
    filled = asyncio.run(fill_missing_leg_odds(client, legs))

    assert filled == 1
    assert legs[0]["odds"] == 1.7
    assert legs[1]["odds"] == 4.0          # untouched
    assert client.calls == ["f1"]          # one fetch for the one fixture


def test_fill_is_best_effort_and_never_raises():
    class BoomClient:
        async def get_odds(self, slug):
            raise RuntimeError("stake unavailable")

    legs = [{"player": "X", "normalizedMarketKey": "hits", "side": "over",
             "line": 0.5, "fixtureSlug": "f1"}]
    filled = asyncio.run(fill_missing_leg_odds(BoomClient(), legs))

    assert filled == 0
    assert "odds" not in legs[0]
