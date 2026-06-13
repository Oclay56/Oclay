from __future__ import annotations

import asyncio
from datetime import date

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


class NoGameYetEngine(FakeEngine):
    async def get_player_recent_history(self, player_id, group="hitting", season=None, limit=25):
        # Player resolves, but no game on the slate date yet (box score not posted).
        return {"games": [{"date": "2025-05-01", "stats": {"hits": 1}}]}


class ScheduleEngine(NoGameYetEngine):
    def __init__(self, *, name_to_id, status, inning=None):
        super().__init__(name_to_id=name_to_id)
        self._status = status
        self._inning = inning

    async def get_schedule(self, game_date):
        # fixtureSlug "reds-astros" -> away "reds", home "astros" both match.
        return {
            "games": [
                {
                    "status": self._status,
                    "inning": self._inning,
                    "awayTeam": {"key": "reds"},
                    "homeTeam": {"key": "astros"},
                }
            ]
        }


def _pending_pick(ledger, *, row_id, player, with_id, market="hits"):
    row = {
        "fixtureSlug": "reds-astros",
        "rowId": row_id,
        "player": player,
        "normalizedMarketKey": market,
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


def test_waiting_on_stats_lists_the_player(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _pending_pick(ledger, row_id="row-4", player="Pending Pat", with_id=True)
    engine = NoGameYetEngine(name_to_id={})  # player resolves by id, but no game yet

    # today is right after the slate, so the pick is genuinely waiting (not stale).
    report = asyncio.run(
        grade_pending_picks(engine, ledger=ledger, slate_date=SLATE, today=date(2025, 5, 9))
    )

    assert report["graded"] == 0
    assert report["needsAttention"] == []
    waiting = report["waitingOn"]
    assert len(waiting) == 1
    assert waiting[0]["player"] == "Pending Pat"
    assert waiting[0]["category"] == "waiting"
    assert "box score" in waiting[0]["reason"]


def test_unmapped_market_is_flagged_for_attention(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _pending_pick(ledger, row_id="row-5", player="Mapped Mike", with_id=True, market="nonsense_prop")
    engine = FakeEngine(name_to_id={})

    report = asyncio.run(grade_pending_picks(engine, ledger=ledger, slate_date=SLATE))

    assert report["waitingOn"] == []
    attention = report["needsAttention"]
    assert len(attention) == 1
    assert attention[0]["player"] == "Mapped Mike"
    assert attention[0]["category"] == "attention"
    assert "not recognized" in attention[0]["reason"]


def test_stale_waiting_pick_is_promoted_to_attention(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _pending_pick(ledger, row_id="row-7", player="Old Game", with_id=True)
    engine = NoGameYetEngine(name_to_id={})  # would be "waiting", but it's days old

    # today is well after the slate -> a real wait would have settled by now.
    report = asyncio.run(
        grade_pending_picks(engine, ledger=ledger, slate_date=SLATE, today=date(2025, 5, 20))
    )

    assert report["waitingOn"] == []
    attention = report["needsAttention"]
    assert len(attention) == 1
    assert attention[0]["player"] == "Old Game"
    assert "still unsettled" in attention[0]["reason"]


def test_unresolved_player_is_flagged_for_attention(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _pending_pick(ledger, row_id="row-6", player="Ghost Player", with_id=False)
    engine = FakeEngine(name_to_id={})  # name never resolves

    report = asyncio.run(grade_pending_picks(engine, ledger=ledger, slate_date=SLATE))

    attention = report["needsAttention"]
    assert len(attention) == 1
    assert attention[0]["player"] == "Ghost Player"
    assert "not matched" in attention[0]["reason"]


def test_waiting_pick_is_tagged_with_live_game_status(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _pending_pick(ledger, row_id="row-8", player="Live Player", with_id=True)
    engine = ScheduleEngine(
        name_to_id={}, status="In Progress", inning={"ordinal": "6th", "state": "Top"}
    )

    report = asyncio.run(
        grade_pending_picks(engine, ledger=ledger, slate_date=SLATE, today=date(2025, 5, 9))
    )

    waiting = report["waitingOn"]
    assert len(waiting) == 1
    assert waiting[0]["gameStatus"] == "In Progress"
    assert waiting[0]["reason"] == "game in progress (Top 6th)"
