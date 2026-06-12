from __future__ import annotations

from app.bet_history_import import parse_bet_history, summarize


SAMPLE = """5 Leg Same Game Multi

4.20
Atlanta Braves - Detroit Tigers

Thu, Apr 30 12:15 PM
Thu, Apr 30
12:15 PM
Atlanta Braves
Detroit Tigers
2
5
Under 0.5 RBIs

Matt Vierling

2
1
Under 0.5 RBIs

Jake Rogers

0
1
Under 1.5 Total Bases

Riley Greene

8
2
Under 0.5 Singles

Connor Norby

Void
0
1
"""


def test_parses_slip_and_grades_legs():
    slips = parse_bet_history(SAMPLE)
    assert len(slips) == 1
    slip = slips[0]
    assert slip.odds == 4.20
    assert slip.matchup == "Atlanta Braves - Detroit Tigers"

    by_player = {leg.player: leg for leg in slip.legs}
    assert by_player["Matt Vierling"].outcome == "loss"   # 2 RBIs, under 0.5
    assert by_player["Matt Vierling"].market_key == "rbi"
    assert by_player["Jake Rogers"].outcome == "win"       # 0 RBIs, under 0.5
    assert by_player["Riley Greene"].outcome == "loss"     # 8 TB, under 1.5
    assert by_player["Riley Greene"].market_key == "total_bases"
    assert by_player["Connor Norby"].outcome == "void"


def test_summary_reports_hit_rates_and_skips_void():
    report = summarize(parse_bet_history(SAMPLE))
    assert report["slips"] == 1
    assert report["gradedLegs"] == 3  # void excluded
    assert "under 0.5 rbi" in report["marketHitRates"] or any(
        "rbi" in key for key in report["marketHitRates"]
    )
