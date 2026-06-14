"""Auto-voiding of pending legs whose player had no game on the slate date.

A DNP / scratch / off-day leg can never settle: there is no box-score line to
grade against. Left alone it clogs the pending list forever. The grader voids
it once the absence is conclusive -- either the player's own log already holds
a strictly-later game, or the slate date is days in the past. A void drops the
leg out of its slip and stays out of calibration.
"""

from __future__ import annotations

import asyncio
from datetime import date

from app.grading import grade_pending_picks
from app.pick_ledger import GRADE_WIN, PickLedger


SLATE = "2025-05-08"


class IdHistoryEngine:
    """Returns a fixed game log per MLB person id."""

    def __init__(self, histories: dict[int, dict]) -> None:
        self.histories = histories

    async def search_players(self, query, limit=5):
        return {"players": []}

    async def get_player_recent_history(self, player_id, group="hitting", season=None, limit=25):
        return self.histories.get(player_id, {"games": []})

    async def get_schedule(self, game_date):
        return {"games": []}


def _record_board(ledger, rows):
    ledger.record_candidate_pool(
        {"mode": "best_available", "rankedCandidates": rows}, slate_date=SLATE
    )


def _row(person_id, player, **over):
    return {
        "fixtureSlug": "reds-astros",
        "rowId": player,
        "player": player,
        "normalizedMarketKey": "hits",
        "side": "over",
        "line": 0.5,
        "odds": 1.8,
        "mlbPersonId": person_id,
        "probabilityAssessment": {"estimatedProbability": 0.6},
        **over,
    }


def test_no_game_with_later_game_in_log_is_auto_voided(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _record_board(ledger, [_row(100, "DNP Dan")])
    # No game on the slate date, but a strictly-later game exists in the log ->
    # conclusive no-show even though the leg is only a day old.
    engine = IdHistoryEngine({100: {"games": [{"date": "2025-05-09", "stats": {}}]}})

    report = asyncio.run(
        grade_pending_picks(engine, ledger=ledger, slate_date=SLATE, today=date(2025, 5, 9))
    )

    assert report["autoVoidedNoGame"] == 1
    assert report["outcomes"]["void"] == 1
    assert report["waitingOn"] == []
    assert report["needsAttention"] == []
    assert ledger.summary()["pendingPicks"] == 0


def test_stale_no_game_is_auto_voided_by_age(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _record_board(ledger, [_row(101, "Old DNP")])
    # Log holds only an earlier game; the slate date is well past with no line.
    engine = IdHistoryEngine({101: {"games": [{"date": "2025-05-01", "stats": {}}]}})

    report = asyncio.run(
        grade_pending_picks(engine, ledger=ledger, slate_date=SLATE, today=date(2025, 5, 20))
    )

    assert report["autoVoidedNoGame"] == 1
    assert ledger.summary()["pendingPicks"] == 0


def test_todays_no_game_stays_waiting_not_voided(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    _record_board(ledger, [_row(102, "Tonight Tom")])
    # No later game, only a day old -> tonight's box score may still post.
    engine = IdHistoryEngine({102: {"games": [{"date": "2025-05-01", "stats": {}}]}})

    report = asyncio.run(
        grade_pending_picks(engine, ledger=ledger, slate_date=SLATE, today=date(2025, 5, 9))
    )

    assert report["autoVoidedNoGame"] == 0
    assert len(report["waitingOn"]) == 1
    assert ledger.summary()["pendingPicks"] == 1


def test_voided_leg_drops_out_of_slip_and_remaining_legs_decide(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    winner = _row(200, "Winner Will")
    no_show = _row(201, "No-show Ned")
    _record_board(ledger, [winner, no_show])
    ledger.record_slip({"legs": [winner, no_show]}, slate_date=SLATE)

    engine = IdHistoryEngine(
        {
            # Winner played on the slate date and cleared the line.
            200: {"games": [{"date": SLATE, "stats": {"hits": 2}}]},
            # No-show has no slate-date game but a later one -> voided.
            201: {"games": [{"date": "2025-05-09", "stats": {}}]},
        }
    )

    report = asyncio.run(
        grade_pending_picks(engine, ledger=ledger, slate_date=SLATE, today=date(2025, 5, 9))
    )

    assert report["outcomes"]["win"] == 1
    assert report["autoVoidedNoGame"] == 1
    # The void leg drops out; the slip settles on the surviving winning leg.
    decided = {s["result"] for s in ledger.decided_slips_with_legs()}
    assert decided == {GRADE_WIN}
