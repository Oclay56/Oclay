"""Avenue 2 -- line-shopping against a sharp book.

Compares a Stake candidate to the sharp no-vig price: edge = sharpFair -
stakeImplied. Positive = Stake beats the sharpest market = overlay. The feed is
pluggable and degrades to no-signal when there is no sharp data.
"""

from __future__ import annotations

import json

from app.sharp_lines import (
    get_active_sharp_lines,
    invalidate_sharp_lines_cache,
    normalize_sharp_entries,
    record_sharp_lines,
    sharp_key,
    sharp_line_edge,
)


# Sharp two-way at 1.95/1.95 devigs to a true 50% per side.
_SHARP = normalize_sharp_entries(
    [{"player": "Aaron Judge", "market": "total_bases", "line": 1.5, "over": 1.95, "under": 1.95, "book": "pinnacle"}]
)


def _candidate(odds, side="over"):
    return {
        "player": "Aaron Judge",
        "normalizedMarketKey": "total_bases",
        "line": 1.5,
        "side": side,
        "odds": odds,
    }


def test_stake_price_beating_the_sharp_line_is_an_overlay():
    # Stake over at 2.30 (implied 0.435) vs sharp true 0.50 -> +0.065 edge.
    sig = sharp_line_edge(_candidate(2.30), sharp_lines=_SHARP)
    assert sig["matched"] is True
    assert sig["direction"] == "beats_sharp_consensus"
    assert sig["edge"] > 0.02
    assert sig["sharpFairProbability"] == 0.5
    assert sig["scoreBonus"] > 0
    assert sig["book"] == "pinnacle"


def test_stake_price_worse_than_sharp_is_flagged_avoid():
    # Stake over at 1.80 (implied 0.556) vs sharp 0.50 -> negative edge.
    sig = sharp_line_edge(_candidate(1.80), sharp_lines=_SHARP)
    assert sig["direction"] == "worse_than_sharp_consensus"
    assert sig["edge"] < -0.02
    assert sig["scoreBonus"] == 0.0


def test_price_in_line_with_sharp_has_no_edge():
    sig = sharp_line_edge(_candidate(2.00), sharp_lines=_SHARP)
    assert sig["direction"] == "in_line_with_sharp"
    assert abs(sig["edge"]) < 0.02


def test_no_sharp_line_for_the_prop_is_no_signal():
    other = {"player": "Someone Else", "normalizedMarketKey": "hits", "line": 0.5, "side": "over", "odds": 2.0}
    sig = sharp_line_edge(other, sharp_lines=_SHARP)
    assert sig["matched"] is False
    assert sig["reason"] == "no_sharp_line_for_prop"


def test_no_sharp_data_degrades_gracefully():
    sig = sharp_line_edge(_candidate(2.30), sharp_lines={})
    assert sig["matched"] is False
    assert sig["scoreBonus"] == 0.0


def test_bonus_scales_with_edge_and_caps():
    small = sharp_line_edge(_candidate(2.10), sharp_lines=_SHARP)  # ~0.024 edge
    big = sharp_line_edge(_candidate(3.50), sharp_lines=_SHARP)    # ~0.214 edge -> saturates
    assert 0 < small["scoreBonus"] < big["scoreBonus"]
    assert big["scoreBonus"] <= 8.0  # capped


def test_normalize_keys_match_the_candidate_lookup():
    assert sharp_key("Aaron Judge", "total_bases", 1.5) in _SHARP


def test_record_and_load_round_trips_via_env_path(tmp_path, monkeypatch):
    path = tmp_path / "sharp.json"
    monkeypatch.setenv("OCLAY_SHARP_LINES_PATH", str(path))
    invalidate_sharp_lines_cache()

    result = record_sharp_lines(
        [{"player": "Mookie Betts", "market": "hits", "line": 0.5, "over": 1.5, "under": 2.5}]
    )
    assert result["entries"] == 1
    assert result["persisted"] is True
    assert json.loads(path.read_text())  # file actually written

    invalidate_sharp_lines_cache()
    loaded = get_active_sharp_lines(force_reload=True)
    assert sharp_key("Mookie Betts", "hits", 0.5) in loaded


def test_disabled_env_returns_empty(monkeypatch):
    monkeypatch.setenv("OCLAY_DISABLE_SHARP_LINES", "1")
    invalidate_sharp_lines_cache()
    assert get_active_sharp_lines(force_reload=True) == {}
    monkeypatch.delenv("OCLAY_DISABLE_SHARP_LINES")
    invalidate_sharp_lines_cache()
