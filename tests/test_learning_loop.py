from __future__ import annotations

import asyncio

from app.calibration import build_calibration_report
from app.grading import grade_pending_picks
from app.pick_ledger import GRADE_LOSS, GRADE_WIN, PickLedger


SLATE = "2026-05-08"


class FakeGradingEngine:
    """Returns a deterministic game log so picks can be settled."""

    def __init__(self, actual_by_person: dict[int, dict[str, float]]):
        self._actual = actual_by_person

    async def get_player_recent_history(self, player_id, group="hitting", season=None, limit=25):
        stats = self._actual.get(int(player_id), {})
        return {
            "playerId": player_id,
            "group": group,
            "games": [{"date": SLATE, "stats": stats}],
        }


def _candidate(row_id, person_id, market, side, line, odds, prob):
    return {
        "fixtureSlug": "reds-astros",
        "matchup": "Reds vs Astros",
        "rowId": row_id,
        "mlbPersonId": person_id,
        "player": f"Player {person_id}",
        "team": "Astros",
        "normalizedMarketKey": market,
        "side": side,
        "line": line,
        "odds": odds,
        "score": 70.0,
        "reliabilityBand": "medium",
        "probabilityAssessment": {
            "impliedProbability": round(1 / odds, 4),
            "fairProbability": round(1 / odds, 4),
            "estimatedProbability": prob,
            "adjustedEstimatedProbability": prob,
            "edge": round(prob - 1 / odds, 4),
            "edgeStatus": "clear_possible_edge" if prob - 1 / odds >= 0.05 else "no_clear_edge",
            "reliabilityBand": "medium",
        },
    }


def test_full_learning_loop(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "ledger.sqlite")

    # Two hitters: one clears the line, one does not.
    pool = {
        "mode": "best_available",
        "date": SLATE,
        "rankedCandidates": [
            _candidate("row-1", 101, "hits", "over", 0.5, 1.8, 0.62),
            _candidate("row-2", 102, "hits", "over", 1.5, 2.4, 0.55),
        ],
    }
    record = ledger.record_candidate_pool(pool, slate_date=SLATE)
    assert record["picksRecorded"] == 2

    # Re-recording the same slate must not duplicate (stable keys).
    again = ledger.record_candidate_pool(pool, slate_date=SLATE)
    assert again["picksRecorded"] == 0

    engine = FakeGradingEngine(
        {
            101: {"hits": 2},  # >= 0.5 over -> WIN
            102: {"hits": 1},  # < 1.5 over  -> LOSS
        }
    )
    report = asyncio.run(grade_pending_picks(engine, ledger=ledger, slate_date=SLATE))
    assert report["graded"] == 2
    assert report["outcomes"][GRADE_WIN] == 1
    assert report["outcomes"][GRADE_LOSS] == 1

    summary = ledger.summary()
    assert summary["gradedPicks"] == 2
    assert summary["gradedHitRate"] == 0.5

    calibration = build_calibration_report(ledger=ledger, persist=False)
    assert calibration["gradedSamples"] == 2
    assert calibration["overall"]["brier"] is not None


def test_pushes_do_not_break_slip_settlement(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "ledger.sqlite")
    slip = {
        "slipId": "slip-1",
        "legCount": 2,
        "rawProductOdds": 3.6,
        "legs": [
            _candidate("row-1", 101, "strikeouts", "over", 6.0, 1.9, 0.55),
            _candidate("row-2", 102, "hits", "over", 0.5, 1.9, 0.6),
        ],
        "slipProbability": {"estimatedWinProbability": 0.3, "expectedValue": 0.1},
    }
    ledger.record_slip(slip, slate_date=SLATE, mode="best_available")

    engine = FakeGradingEngine(
        {
            101: {"strikeOuts": 6},  # integer line 6.0 -> PUSH
            102: {"hits": 1},  # over 0.5 -> WIN
        }
    )
    asyncio.run(grade_pending_picks(engine, ledger=ledger, slate_date=SLATE))

    # grade_pending_picks settles slips internally; a push + win settles to win.
    import sqlite3

    conn = sqlite3.connect(ledger.db_path)
    conn.row_factory = sqlite3.Row
    result = conn.execute("SELECT result FROM slips WHERE slip_id = ?", ("slip-1",)).fetchone()
    conn.close()
    assert result["result"] == "win"
