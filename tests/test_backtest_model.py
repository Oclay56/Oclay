from __future__ import annotations

import asyncio

from app.backtest_model import run_model_backtest
from app.pick_ledger import PickLedger


SLATE = "2025-05-15"


class FakeEngine:
    """Returns a fixed game log of pre-slate games and resolves names by search."""

    def __init__(self, *, hits_per_game: list[int], known_id: int = 100) -> None:
        self.hits_per_game = hits_per_game
        self.known_id = known_id

    async def search_players(self, query, limit=5):
        return {"players": [{"name": query, "mlbId": self.known_id}]}

    async def get_player_recent_history(self, player_id, group="hitting", season=None, limit=100):
        # All games dated before the slate date so they count point-in-time.
        games = [
            {"date": f"2025-04-{day:02d}", "stats": {"hits": hits}}
            for day, hits in enumerate(self.hits_per_game, start=1)
        ]
        return {"playerId": player_id, "games": games}


def _record_graded_pick(ledger, *, row_id, person_id, outcome, with_id=True):
    row = {
        "fixtureSlug": "reds-astros",
        "rowId": row_id,
        "player": "Test Player",
        "normalizedMarketKey": "hits",
        "side": "under",
        "line": 1.5,
        "odds": 1.9,
        "probabilityAssessment": {"estimatedProbability": 0.6},
    }
    if with_id:
        row["mlbPersonId"] = person_id
    ledger.record_candidate_pool(
        {"mode": "best_available", "rankedCandidates": [row]}, slate_date=SLATE
    )
    ledger.apply_grade(f"{SLATE}:{row_id}", outcome=outcome, actual_value=0.0)


def test_model_backtest_scores_pick_point_in_time(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    # Five pre-slate games averaging ~1.0 hits -> a real under-1.5 probability.
    _record_graded_pick(ledger, row_id="row-1", person_id=100, outcome="win")
    engine = FakeEngine(hits_per_game=[1, 0, 2, 1, 1])

    report = asyncio.run(run_model_backtest(engine, ledger=ledger, min_prior_games=3))

    assert report["consideredPicks"] == 1
    assert report["scoredPicks"] == 1
    assert report["status"] == "ok"
    assert 0.0 <= report["brierScore"] <= 1.0
    assert report["reliabilityCurve"]


def test_model_backtest_resolves_player_by_name_when_id_missing(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _record_graded_pick(ledger, row_id="row-2", person_id=100, outcome="loss", with_id=False)
    engine = FakeEngine(hits_per_game=[1, 1, 1, 2, 0])

    report = asyncio.run(run_model_backtest(engine, ledger=ledger, min_prior_games=3))

    # No stored id, but name search resolved it -> still scored.
    assert report["scoredPicks"] == 1
    assert report["coverageGaps"]["unresolvedPlayer"] == 0


def test_model_backtest_reports_insufficient_history(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _record_graded_pick(ledger, row_id="row-3", person_id=100, outcome="win")
    engine = FakeEngine(hits_per_game=[1])  # only one prior game, below the floor

    report = asyncio.run(run_model_backtest(engine, ledger=ledger, min_prior_games=3))

    assert report["scoredPicks"] == 0
    assert report["coverageGaps"]["insufficientPriorGames"] == 1
    assert report["status"] == "no_scoreable_history"
