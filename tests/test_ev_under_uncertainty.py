"""EV under uncertainty: per-leg probability error bars bracket the slip EV.

Each leg probability is an estimate with an error bar. Across many legs those
errors compound multiplicatively, so a slip that looks +EV at the point
estimate can be sharply -EV at the lower bound. The slip math now reports that
range instead of a single deceptively-precise number.
"""

from __future__ import annotations

from app.correlation import slip_probability_and_ev


def _leg(fix, player, prob, odds, ci=None):
    leg = {
        "fixtureSlug": fix,
        "player": player,
        "normalizedMarketKey": "hits",
        "side": "over",
        "winProbability": prob,
        "odds": odds,
    }
    if ci:
        leg["confidenceInterval"] = ci
    return leg


def _spread(n, ci=None):
    return [_leg(f"g{i}", f"P{i}", 0.55, 1.9, ci=ci) for i in range(n)]


def test_leg_intervals_produce_a_win_prob_and_ev_range():
    legs = _spread(4, ci={"low": 0.45, "high": 0.65})
    out = slip_probability_and_ev(legs)

    assert out["uncertaintyFromLegIntervals"] is True
    lo, hi = out["winProbabilityRange"]
    assert lo < out["estimatedWinProbability"] < hi
    elo, ehi = out["expectedValueRange"]
    assert elo < out["expectedValue"] < ehi
    assert out["evDownsidePerUnit"] == elo


def test_point_can_look_positive_while_downside_is_negative():
    # The sobering case: +EV at the point estimate, -EV at the low bound.
    out = slip_probability_and_ev(_spread(4, ci={"low": 0.45, "high": 0.65}))
    assert out["expectedValue"] > 0
    assert out["evDownsidePerUnit"] < 0


def test_more_legs_compound_a_worse_downside():
    ci = {"low": 0.45, "high": 0.65}
    two = slip_probability_and_ev(_spread(2, ci=ci))
    six = slip_probability_and_ev(_spread(6, ci=ci))
    # Independent error bars multiply: more legs -> the joint low collapses
    # faster -> a deeper downside on the same per-leg uncertainty.
    assert six["evDownsidePerUnit"] < two["evDownsidePerUnit"]


def test_legs_without_intervals_have_no_band():
    out = slip_probability_and_ev(_spread(3))
    assert out["uncertaintyFromLegIntervals"] is False
    lo, hi = out["winProbabilityRange"]
    assert lo == hi == out["estimatedWinProbability"]
    elo, ehi = out["expectedValueRange"]
    assert elo == ehi == out["expectedValue"]
