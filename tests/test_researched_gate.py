from __future__ import annotations

import asyncio

from app.sgm_candidate_pool import build_sgm_candidate_pool_from_boards


class PartialEngine:
    """Altuve loads real stats; player 999 matches name but has no stats."""

    async def search_players(self, query, limit=5):
        mlb_id = 101 if "Altuve" in query else 999
        return {"players": [{"mlbId": mlb_id, "name": query, "key": query.lower().replace(" ", "-"),
                             "team": {"name": "Houston Astros", "key": "houston-astros"}}]}

    async def get_schedule(self, game_date):
        return {"date": game_date, "games": [{"gamePk": 1, "status": "Scheduled",
                "awayTeam": {"name": "Cincinnati Reds", "key": "cincinnati-reds"},
                "homeTeam": {"name": "Houston Astros", "key": "houston-astros"}}]}

    async def get_team_roster(self, team_id, season=None):
        return {"players": []}

    async def get_player_profile(self, player_id, season=None, group="hitting"):
        if player_id == 999:
            return {"player": {"mlbId": 999, "name": "Ghost Player", "stats": {}}}
        return {"player": {"mlbId": player_id, "name": "Jose Altuve",
                           "stats": {"gamesPlayed": 60, "plateAppearances": 260, "hits": 95}}}

    async def get_player_recent_history(self, player_id, group="hitting", season=None, limit=10):
        if player_id == 999:
            return {"gamesUsed": 0, "games": [], "totals": {}, "perGame": {}}
        return {"gamesUsed": 15, "games": [{"date": f"2026-05-{i + 1:02d}", "stats": {"hits": 2}}
                                           for i in range(15)],
                "totals": {"hits": 30}, "perGame": {"hits": 2.0}}

    async def get_player_splits(self, *args, **kwargs):
        return {"splits": []}

    async def get_game_context(self, game_pk):
        return {"venue": {"name": "X"}, "status": {}, "teams": {}}


class ExplodingEngine(PartialEngine):
    async def get_player_profile(self, player_id, season=None, group="hitting"):
        if player_id == 999:
            raise RuntimeError("MLB API 500 for this player")
        return await super().get_player_profile(player_id, season=season, group=group)


def _boards():
    return [{
        "fixtureSlug": "reds-astros", "capturedAt": None, "source": "stake_ui",
        "playerProps": [
            {"player": "Jose Altuve", "team": "Houston Astros", "market": "Hits", "scope": "player",
             "position": "", "line": 0.5, "over": 1.8, "under": 2.1, "playable": True,
             "balanced": True, "lineId": "L1", "marketId": "M1"},
            {"player": "Ghost Player", "team": "Houston Astros", "market": "Hits", "scope": "player",
             "position": "", "line": 0.5, "over": 1.8, "under": 2.1, "playable": True,
             "balanced": True, "lineId": "L2", "marketId": "M2"},
        ],
        "teamMarkets": [],
    }]


def test_player_without_loaded_stats_is_excluded():
    pool = asyncio.run(build_sgm_candidate_pool_from_boards(
        _boards(), PartialEngine(), date="2026-05-08", side="over",
        mode="best_available", quality_floor=0,
    ))
    players = [(c["player"], c["researched"]) for c in pool["rankedCandidates"]]
    assert ("Jose Altuve", True) in players
    assert all(name != "Ghost Player" for name, _ in players)
    assert pool["rejectedSummary"].get("insufficient_researched_data", 0) >= 1
    assert pool["researchCoverage"]["allReturnedRowsResearched"] is True


def test_one_failed_player_does_not_break_the_slate():
    # The exploding engine raises for player 999 only; Altuve must still surface.
    pool = asyncio.run(build_sgm_candidate_pool_from_boards(
        _boards(), ExplodingEngine(), date="2026-05-08", side="over",
        mode="best_available", quality_floor=0,
    ))
    names = [c["player"] for c in pool["rankedCandidates"]]
    assert "Jose Altuve" in names
    assert "Ghost Player" not in names


def test_every_returned_candidate_is_researched():
    pool = asyncio.run(build_sgm_candidate_pool_from_boards(
        _boards(), PartialEngine(), date="2026-05-08", side="over",
        mode="best_available", quality_floor=0,
    ))
    assert all(c.get("researched") is True for c in pool["rankedCandidates"])
