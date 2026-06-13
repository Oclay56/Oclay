from __future__ import annotations

from app.backtest import run_backtest
from app.bet_history_import import parse_bet_history, slate_date_for
from app.pick_ledger import PickLedger


# Two slips: one wins outright, one loses on a single leg.
WINNING_SLIP = """2 Leg Same Game Multi

3.50
Atlanta Braves - Detroit Tigers

Thu, Apr 30 12:15 PM
Under 0.5 RBIs

Jake Rogers

0
1
Under 1.5 Total Bases

Spencer Torkelson

1
2
"""

LOSING_SLIP = """2 Leg Same Game Multi

4.00
Atlanta Braves - Detroit Tigers

Fri, May 02 12:15 PM
Under 0.5 RBIs

Matt Vierling

2
1
Under 1.5 Total Bases

Riley Greene

8
2
"""


def test_slate_date_for_attaches_season():
    assert slate_date_for("Thu, Apr 30 12:15 PM", 2025) == "2025-04-30"
    assert slate_date_for("Fri, May 02", 2025) == "2025-05-02"
    assert slate_date_for(None, 2025) is None


def _ledger(tmp_path) -> PickLedger:
    return PickLedger(db_path=tmp_path / "ledger.sqlite")


def test_import_loads_graded_history_into_ledger(tmp_path):
    ledger = _ledger(tmp_path)
    slips = parse_bet_history(WINNING_SLIP) + parse_bet_history(LOSING_SLIP)
    loaded = ledger.record_imported_slips(slips, season=2025)

    assert loaded["slipsLoaded"] == 2
    assert loaded["legsLoaded"] == 4

    summary = ledger.summary()
    assert summary["gradedPicks"] == 4  # all four legs settled, none pending
    assert summary["pendingPicks"] == 0


def test_import_is_idempotent(tmp_path):
    ledger = _ledger(tmp_path)
    slips = parse_bet_history(WINNING_SLIP)
    ledger.record_imported_slips(slips, season=2025)
    second = ledger.record_imported_slips(slips, season=2025)

    # Re-importing the same export must not duplicate.
    assert second["legsLoaded"] == 0
    assert second["slipsLoaded"] == 0
    assert ledger.summary()["totalPicks"] == 2


def test_backtest_reports_leg_and_slip_performance(tmp_path):
    ledger = _ledger(tmp_path)
    slips = parse_bet_history(WINNING_SLIP) + parse_bet_history(LOSING_SLIP)
    ledger.record_imported_slips(slips, season=2025)

    report = run_backtest(ledger, min_market_samples=1)

    legs = report["legPerformance"]
    assert legs["gradedLegs"] == 4
    assert legs["wins"] == 2  # both legs of the winning slip

    slip_perf = report["slipPerformance"]
    assert slip_perf["decidedSlips"] == 2
    assert slip_perf["winRate"] == 0.5
    # One 3.50 winner (+2.50) and one loser (-1.00) over two units = +0.75 ROI.
    assert slip_perf["roi"] == 0.75

    # No model estimates on imported history yet.
    assert report["modelCalibration"]["status"] == "no_model_scored_history_yet"


def test_per_market_roi_uses_individual_leg_odds(tmp_path):
    ledger = _ledger(tmp_path)
    # A logged slip carries each leg's own odds (the GPT path), unlike imports.
    ledger.record_slip(
        {
            "legs": [
                {"rowId": "r1", "player": "A", "normalizedMarketKey": "hits",
                 "side": "over", "line": 0.5, "odds": 3.0},
                {"rowId": "r2", "player": "B", "normalizedMarketKey": "rbi",
                 "side": "over", "line": 0.5, "odds": 2.0},
            ],
        },
        slate_date="2025-05-08",
    )
    pending = {p["player"]: p["pick_key"] for p in ledger.pending_picks()}
    ledger.apply_grade(pending["A"], outcome="win", actual_value=1)   # +2.0 at 3.0
    ledger.apply_grade(pending["B"], outcome="loss", actual_value=0)  # -1.0 at 2.0

    leg = run_backtest(ledger, min_market_samples=1)["legPerformance"]

    by_market = {m["market"]: m for m in leg["byMarket"]}
    assert by_market["hits:over"]["pricedLegs"] == 1
    assert by_market["hits:over"]["roi"] == 2.0
    assert by_market["rbi:over"]["roi"] == -1.0

    # Straight-bet leg ROI: (+2.0 - 1.0) / 2 priced legs = +0.5.
    assert leg["legRoi"]["pricedLegs"] == 2
    assert leg["legRoi"]["roi"] == 0.5

    # The negative-ROI market is flagged.
    assert any(m["market"] == "rbi:over" for m in leg["losingMarkets"])

    # Imported legs (no odds) stay hit-rate only -- never faked into the money math.
    imported = _ledger(tmp_path.with_name("imported"))
    imported.record_imported_slips(parse_bet_history(WINNING_SLIP), season=2025)
    imp_leg = run_backtest(imported, min_market_samples=1)["legPerformance"]
    assert imp_leg["legRoi"]["pricedLegs"] == 0
    assert imp_leg["legRoi"]["roi"] is None
