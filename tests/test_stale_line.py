"""Stale-line / latency edge detector.

Fires only when a discrete fresh-info event (a *confirmed* lineup slot or a
weather shift) moved the model toward this bet's side AND the model still beats
Stake's current line -- i.e. the line hasn't repriced. A line that already
reflects the info shows no edge, so it never fires.
"""

from __future__ import annotations

from app.stale_line import detect_stale_line


def _candidate(side="over", *, lineup_confirmed=True, batting_order=2):
    return {
        "side": side,
        "lineupContext": {"lineupConfirmed": lineup_confirmed, "battingOrder": batting_order},
    }


def _assessment(adjustments, edge):
    return {"edge": edge, "inputs": {"meanAdjustments": adjustments}}


def test_confirmed_lineup_slot_with_edge_is_stale():
    cand = _candidate(side="over", batting_order=2)
    asmt = _assessment([{"source": "lineup_spot_pa_volume", "factor": 1.08}], edge=0.06)
    sig = detect_stale_line(cand, asmt)
    assert sig["isStale"] is True
    assert sig["trigger"] == "confirmed_lineup_slot"
    assert sig["direction"] == "over"
    assert sig["scoreBonus"] > 0
    assert 0.6 <= sig["stalenessScore"] <= 0.8  # 0.08 shift + 0.06 edge


def test_lineup_shift_does_not_fire_until_lineup_is_confirmed():
    cand = _candidate(side="over", lineup_confirmed=False)
    asmt = _assessment([{"source": "lineup_spot_pa_volume", "factor": 1.08}], edge=0.06)
    assert detect_stale_line(cand, asmt)["isStale"] is False


def test_weather_shift_fires_as_weather_trigger():
    cand = _candidate(side="over", lineup_confirmed=False)
    asmt = _assessment([{"source": "weather", "factor": 1.06}], edge=0.05)
    sig = detect_stale_line(cand, asmt)
    assert sig["isStale"] is True
    assert sig["trigger"] == "weather_shift"


def test_under_side_with_a_downward_slot_shift_is_stale():
    cand = _candidate(side="under", batting_order=8)
    asmt = _assessment([{"source": "lineup_spot_pa_volume", "factor": 0.92}], edge=0.05)
    sig = detect_stale_line(cand, asmt)
    assert sig["isStale"] is True
    assert sig["direction"] == "under"


def test_info_pointing_the_wrong_way_does_not_fire():
    # Slot shift favors OVER, but the bet is the UNDER -> not actionable.
    cand = _candidate(side="under", batting_order=2)
    asmt = _assessment([{"source": "lineup_spot_pa_volume", "factor": 1.08}], edge=0.06)
    sig = detect_stale_line(cand, asmt)
    assert sig["isStale"] is False
    assert sig["aligned"] is False


def test_no_model_edge_means_line_already_priced_it():
    # Info moved the mean, but there's no edge over the line -> already priced.
    cand = _candidate(side="over", batting_order=2)
    asmt = _assessment([{"source": "lineup_spot_pa_volume", "factor": 1.08}], edge=0.01)
    assert detect_stale_line(cand, asmt)["isStale"] is False


def test_tiny_shift_below_threshold_does_not_fire():
    cand = _candidate(side="over", batting_order=5)
    asmt = _assessment([{"source": "lineup_spot_pa_volume", "factor": 1.01}], edge=0.06)
    assert detect_stale_line(cand, asmt)["isStale"] is False


def test_non_fresh_adjustments_are_ignored():
    # Park/handedness are real but not *fresh* events -> not a latency edge.
    cand = _candidate(side="over")
    asmt = _assessment(
        [{"source": "park_factor", "factor": 1.12}, {"source": "handedness_platoon", "factor": 1.10}],
        edge=0.08,
    )
    assert detect_stale_line(cand, asmt)["isStale"] is False


def test_no_adjustments_is_not_stale():
    assert detect_stale_line(_candidate(), _assessment([], edge=0.06))["isStale"] is False
