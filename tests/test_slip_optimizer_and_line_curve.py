from __future__ import annotations

from app.sgm_candidate_pool import _apply_line_curve_contest, leg_expected_value
from app.slip_optimizer import build_ev_max_slip


def _leg(player, market, side, odds, prob, line=0.5, rowid="r"):
    return {
        "fixtureSlug": "g1",
        "player": player,
        "normalizedMarketKey": market,
        "side": side,
        "odds": odds,
        "line": line,
        "rowId": rowid,
        "winProbability": prob,
        "probabilityAssessment": {"estimatedProbability": prob},
        "score": 60.0,
    }


def test_line_curve_picks_highest_ev_line():
    rows = [
        _leg("Altuve", "hits", "over", 1.4, 0.70, line=0.5, rowid="a"),
        _leg("Altuve", "hits", "over", 3.2, 0.42, line=1.5, rowid="b"),
        _leg("Altuve", "hits", "over", 9.0, 0.10, line=2.5, rowid="c"),
    ]
    result = _apply_line_curve_contest(rows)
    assert result["contestedGroups"] == 1
    leader = next(r for r in rows if r["lineCurve"]["isValueLeader"])
    assert leader["line"] == 1.5
    dominated = [r for r in rows if not r["lineCurve"]["isValueLeader"]]
    assert all("line_curve_dominated_by_better_line" in r.get("reasonTags", []) for r in dominated)


def test_leg_expected_value_matches_formula():
    leg = _leg("X", "hits", "over", 2.0, 0.6)
    assert leg_expected_value(leg) == round(0.6 * 1.0 - 0.4, 4)


def test_ev_max_stops_at_peak_not_max_legs():
    legs = [
        _leg("A", "hits", "over", 1.9, 0.62, rowid="r1"),
        _leg("B", "strikeouts", "over", 2.1, 0.55, rowid="r2"),
        _leg("C", "total_bases", "over", 3.0, 0.30, rowid="r3"),
        _leg("D", "home_runs", "over", 5.0, 0.12, rowid="r4"),
    ]
    slip = build_ev_max_slip(legs, min_legs=2, max_legs=8)
    assert slip["legCount"] == 2
    assert slip["stoppedReason"] == "expected_value_peaked"
    assert set(leg["rowId"] for leg in slip["legs"]) == {"r1", "r2"}


def test_ev_max_one_leg_per_player():
    legs = [
        _leg("A", "hits", "over", 1.9, 0.62, rowid="r1"),
        _leg("A", "total_bases", "over", 2.5, 0.5, rowid="r2"),
        _leg("B", "strikeouts", "over", 2.1, 0.55, rowid="r3"),
    ]
    slip = build_ev_max_slip(legs, min_legs=2, max_legs=8)
    players = [leg["player"] for leg in slip["legs"]]
    assert len(players) == len(set(players))
