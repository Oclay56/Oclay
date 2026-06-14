"""Closing-line value aggregation -- the Trainer's edge-proof headline."""

from __future__ import annotations

from app.pick_ledger import PickLedger, _compute_clv


SLATE = "2025-05-08"


def _row(row_id, market, odds):
    return {
        "fixtureSlug": "reds-astros",
        "rowId": row_id,
        "player": f"Player {row_id}",
        "normalizedMarketKey": market,
        "side": "over",
        "line": 0.5,
        "odds": odds,
        "mlbPersonId": 100,
        "probabilityAssessment": {"estimatedProbability": 0.6},
    }


def test_clv_aggregates_over_picks_with_a_closing_snapshot(tmp_path):
    led = PickLedger(db_path=tmp_path / "l.sqlite")
    led.record_candidate_pool(
        {
            "mode": "best_available",
            "rankedCandidates": [
                _row("a", "hits", 2.0),  # taken 2.0, closes 1.8 -> beat the close
                _row("b", "hits", 1.8),  # taken 1.8, closes 2.0 -> lost to the close
                _row("c", "total_bases", 2.0),  # no snapshot -> excluded entirely
            ],
        },
        slate_date=SLATE,
    )
    led.record_closing_snapshot([{"rowId": "a", "odds": 1.8}, {"rowId": "b", "odds": 2.0}])

    clv = led.clv_by_market()
    hits = clv["byMarket"]["hits"]
    assert hits["samples"] == 2
    expected_avg = round((_compute_clv(2.0, 1.8) + _compute_clv(1.8, 2.0)) / 2, 4)
    assert hits["avgClv"] == expected_avg
    assert hits["beatCloseRate"] == 0.5
    # The pick without a closing snapshot contributes nothing.
    assert "total_bases" not in clv["byMarket"]
    assert clv["overall"]["samples"] == 2


def test_clv_works_before_settlement(tmp_path):
    # CLV needs only open vs closing odds -- not the game result -- so a pending
    # (ungraded) pick still counts. That is the whole point: edge proof early.
    led = PickLedger(db_path=tmp_path / "l.sqlite")
    led.record_candidate_pool(
        {"mode": "best_available", "rankedCandidates": [_row("x", "hits", 2.5)]},
        slate_date=SLATE,
    )
    led.record_closing_snapshot([{"rowId": "x", "odds": 2.0}])

    assert led.summary()["pendingPicks"] == 1  # never graded
    clv = led.clv_by_market()
    assert clv["overall"]["samples"] == 1
    assert clv["overall"]["avgClv"] == round(2.5 / 2.0 - 1, 4)
    assert clv["overall"]["beatCloseRate"] == 1.0


def test_no_snapshots_yields_empty_clv(tmp_path):
    led = PickLedger(db_path=tmp_path / "l.sqlite")
    led.record_candidate_pool(
        {"mode": "best_available", "rankedCandidates": [_row("a", "hits", 2.0)]},
        slate_date=SLATE,
    )
    clv = led.clv_by_market()
    assert clv["overall"]["samples"] == 0
    assert clv["overall"]["avgClv"] is None
    assert clv["byMarket"] == {}
