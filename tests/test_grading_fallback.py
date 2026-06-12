from __future__ import annotations

import asyncio

from app.grading import grade_pending_picks
from app.pick_ledger import PickLedger


SLATE = "2025-05-08"


class FakeEngine:
    def __init__(self, *, name_to_id: dict[str, int]) -> None:
        self.name_to_id = name_to_id
        self.search_calls = 0

    async def search_players(self, query, limit=5):
        self.search_calls += 1
        person_id = self.name_to_id.get(query)
        if person_id is None:
            return {"players": []}
        return {"players": [{"name": query, "mlbId": person_id}]}

    async def get_player_recent_history(self, player_id, group="hitting", season=None, limit=25):
        return {"games": [{"date": SLATE, "stats": {"hits": 2}}]}


def _pending_pick(ledger, *, row_id, player, with_id):
    row = {
        "fixtureSlug": "reds-astros",
        "rowId": row_id,
        "player": player,
        "normalizedMarketKey": "hits",
        "side": "over",
        "line": 0.5,
        "odds": 1.8,
        "probabilityAssessment": {"estimatedProbability": 0.6},
    }
    if with_id:
        row["mlbPersonId"] = 100
    ledger.record_candidate_pool(
        {"mode": "best_available", "rankedCandidates": [row]}, slate_date=SLATE
    )


def test_pick_without_id_still_grades_via_name(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _pending_pick(ledger, row_id="row-1", player="Some Player", with_id=False)
    engine = FakeEngine(name_to_id={"Some Player": 555})

    report = asyncio.run(grade_pending_picks(engine, ledger=ledger, slate_date=SLATE))

    assert report["graded"] == 1
    assert report["outcomes"]["win"] == 1
    assert engine.search_calls == 1  # the backup fired


def test_resolved_id_is_saved_back_so_it_is_one_time(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _pending_pick(ledger, row_id="row-1", player="Some Player", with_id=False)
    engine = FakeEngine(name_to_id={"Some Player": 555})

    asyncio.run(grade_pending_picks(engine, ledger=ledger, slate_date=SLATE))

    # The resolved id is now stored on the pick, so it never needs a lookup again.
    import sqlite3

    conn = sqlite3.connect(ledger.db_path)
    row = conn.execute(
        "SELECT mlb_person_id FROM picks WHERE player = ?", ("Some Player",)
    ).fetchone()
    assert row[0] == 555


def test_normal_path_with_id_never_calls_name_search(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _pending_pick(ledger, row_id="row-2", player="Some Player", with_id=True)
    engine = FakeEngine(name_to_id={"Some Player": 555})

    report = asyncio.run(grade_pending_picks(engine, ledger=ledger, slate_date=SLATE))

    assert report["graded"] == 1
    # The id was present, so the name-resolution backup never ran.
    assert engine.search_calls == 0


def test_unresolved_name_leaves_pick_pending(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _pending_pick(ledger, row_id="row-3", player="Ghost Player", with_id=False)
    engine = FakeEngine(name_to_id={})  # name not found

    report = asyncio.run(grade_pending_picks(engine, ledger=ledger, slate_date=SLATE))

    assert report["graded"] == 0
    assert report["skippedUnresolved"] == 1
    # Left pending for a later retry, not voided.
    assert ledger.summary()["pendingPicks"] == 1
