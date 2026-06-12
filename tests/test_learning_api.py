from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app, get_mlb_engine, get_pick_ledger
from app.pick_ledger import PickLedger


SLATE = "2026-05-08"


class FakeGradingEngine:
    async def get_player_recent_history(self, player_id, group="hitting", season=None, limit=25):
        return {"games": [{"date": SLATE, "stats": {"hits": 2}}]}


def _record_a_pick(ledger: PickLedger):
    ledger.record_candidate_pool(
        {
            "mode": "best_available",
            "date": SLATE,
            "rankedCandidates": [
                {
                    "fixtureSlug": "reds-astros",
                    "rowId": "row-1",
                    "mlbPersonId": 101,
                    "player": "Player 101",
                    "team": "Astros",
                    "normalizedMarketKey": "hits",
                    "side": "over",
                    "line": 0.5,
                    "odds": 1.8,
                    "score": 70.0,
                    "probabilityAssessment": {
                        "impliedProbability": 0.5556,
                        "fairProbability": 0.54,
                        "estimatedProbability": 0.62,
                        "edge": 0.08,
                        "edgeStatus": "clear_possible_edge",
                        "reliabilityBand": "medium",
                    },
                }
            ],
        },
        slate_date=SLATE,
    )


def test_record_slip_endpoint_logs_chosen_legs(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "ledger.sqlite")

    chosen = {
        "date": SLATE,
        "mode": "best_available",
        "rawProductOdds": 3.24,
        "slipProbability": {"estimatedWinProbability": 0.41, "expectedValue": 0.12},
        "legs": [
            {
                "fixtureSlug": "reds-astros",
                "rowId": "row-1",
                "player": "Player 101",
                "team": "Astros",
                "normalizedMarketKey": "hits",
                "side": "over",
                "line": 0.5,
                "odds": 1.8,
                "probabilityAssessment": {"estimatedProbability": 0.62, "edge": 0.08},
            },
            {
                "fixtureSlug": "reds-astros",
                "rowId": "row-2",
                "player": "Player 202",
                "team": "Reds",
                "normalizedMarketKey": "total_bases",
                "side": "under",
                "line": 1.5,
                "odds": 1.8,
                "probabilityAssessment": {"estimatedProbability": 0.58, "edge": 0.05},
            },
        ],
    }

    app.dependency_overrides[get_pick_ledger] = lambda: ledger
    try:
        with TestClient(app) as client:
            recorded = client.post("/oclay/learning/record-slip", json=chosen)
            missing = client.post("/oclay/learning/record-slip", json={"date": SLATE})
    finally:
        app.dependency_overrides.clear()

    assert recorded.status_code == 200
    body = recorded.json()
    assert body["recorded"] is True
    assert body["reviewOnly"] is True
    assert body["legsRecorded"] == 2

    # Both legs land as pending picks ready for grading, plus one slip row.
    summary = ledger.summary()
    assert summary["pendingPicks"] == 2
    assert summary["slips"] == 1

    # A body with no legs is a clean 422, not a crash.
    assert missing.status_code == 422


def test_learning_endpoints_grade_and_report(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "ledger.sqlite")
    _record_a_pick(ledger)

    app.dependency_overrides[get_pick_ledger] = lambda: ledger
    app.dependency_overrides[get_mlb_engine] = lambda: FakeGradingEngine()
    try:
        with TestClient(app) as client:
            summary = client.get("/oclay/learning/summary")
            grade = client.post("/oclay/learning/grade", json={"date": SLATE})
            report = client.get("/oclay/learning/calibration-report")
    finally:
        app.dependency_overrides.clear()

    assert summary.status_code == 200
    assert summary.json()["ledger"]["pendingPicks"] == 1

    assert grade.status_code == 200
    assert grade.json()["graded"] == 1
    assert grade.json()["outcomes"]["win"] == 1

    assert report.status_code == 200
    assert report.json()["gradedSamples"] == 1
