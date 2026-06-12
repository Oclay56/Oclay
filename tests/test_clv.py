from __future__ import annotations

from app.clv import clv_report
from app.pick_ledger import PickLedger


def _pool(*rows: dict) -> dict:
    return {"mode": "best_available", "rankedCandidates": list(rows)}


def _row(row_id: str, person_id: int, odds: float) -> dict:
    return {
        "fixtureSlug": "reds-astros",
        "rowId": row_id,
        "mlbPersonId": person_id,
        "player": f"Player {person_id}",
        "normalizedMarketKey": "hits",
        "side": "under",
        "line": 1.5,
        "odds": odds,
        "probabilityAssessment": {"estimatedProbability": 0.6},
    }


def test_update_closing_odds_respects_cutoff(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    ledger.record_candidate_pool(_pool(_row("row-1", 100, 2.0)), slate_date="2025-05-01")
    snaps = [{"rowId": "row-1", "odds": 1.8}]

    # Cutoff in the past: the pick was recorded after it -> excluded (it's a
    # fresh row, not a re-scan), so nothing is captured as closing.
    past = ledger.update_closing_odds(snaps, recorded_before="2000-01-01T00:00:00+00:00")
    assert past["closingOddsUpdated"] == 0

    # Cutoff in the future: the pick predates it -> captured as closing.
    future = ledger.update_closing_odds(snaps, recorded_before="2999-01-01T00:00:00+00:00")
    assert future["closingOddsUpdated"] == 1


def test_clv_report_computes_beat_close_and_outcome(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    ledger.record_candidate_pool(
        _pool(_row("row-1", 100, 2.0), _row("row-2", 200, 1.7)),
        slate_date="2025-05-01",
    )
    # row-1 closed shorter (we beat the close); row-2 closed longer (we missed).
    ledger.update_closing_odds(
        [{"rowId": "row-1", "odds": 1.8}, {"rowId": "row-2", "odds": 1.9}],
        recorded_before="2999-01-01T00:00:00+00:00",
    )
    # Grade them: the beat-close pick won, the missed-close pick lost.
    ledger.apply_grade("2025-05-01:row-1", outcome="win", actual_value=0.0)
    ledger.apply_grade("2025-05-01:row-2", outcome="loss", actual_value=3.0)

    report = clv_report(ledger=ledger, min_market_samples=1)

    assert report["pricedPicks"] == 2
    assert report["beatCloseRate"] == 0.5
    # (2.0/1.8 - 1) + (1.7/1.9 - 1) averaged.
    assert abs(report["averageClv"] - 0.0029) < 0.01
    vs = report["clvVsOutcome"]
    assert vs["gradedPricedPicks"] == 2
    assert vs["winRateWhenBeatClose"] == 1.0
    assert vs["winRateWhenMissedClose"] == 0.0


def test_clv_report_empty_when_no_closing_lines(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    ledger.record_candidate_pool(_pool(_row("row-1", 100, 2.0)), slate_date="2025-05-01")
    report = clv_report(ledger=ledger)
    assert report["status"] == "no_closing_lines_yet"
    assert report["pricedPicks"] == 0
