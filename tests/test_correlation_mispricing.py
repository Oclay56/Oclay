"""Avenue 1 -- correlation-mispricing detector.

The signal is the real-quote realizedScalar (M_model / M_stake_real) bucketed by
correlation category. A category whose scalar runs > 1 is one where Stake's real
quotes are more generous than the realized-co-hit copula expects -- Stake
under-prices that correlation structure, a structural overlay. The scorer reads
only real-quote data (never the predicted quote), so it is not circular.
"""

from __future__ import annotations

from app.pick_ledger import PickLedger
from app.quote_model import (
    _dominant_correlation_category,
    correlation_edge,
    fit_quote_model,
    quote_observation,
)
from app.thesis_blocks import build_block


def _leg(fix, player, team, market, side, odds=1.9, prob=0.55):
    return {
        "fixtureSlug": fix,
        "player": player,
        "team": team,
        "normalizedMarketKey": market,
        "side": side,
        "odds": odds,
        "winProbability": prob,
    }


def _block_legs():
    # Two different players, same team, both batter-volume unders.
    return [
        _leg("g1", "A", "NY", "hits", "under"),
        _leg("g1", "B", "NY", "total_bases", "under"),
    ]


_CATEGORY = "same_team_offense_same_dir"


def test_dominant_category_matches_the_copula_buckets():
    assert _dominant_correlation_category(_block_legs()) == _CATEGORY


def test_no_model_is_a_neutral_baseline():
    edge = correlation_edge(_block_legs(), model={})
    assert edge["edgeRatio"] == 1.0
    assert edge["edgeDirection"] == "fairly_priced"
    assert edge["confidence"] == "prior"


def test_underpriced_category_is_flagged_as_overlay():
    model = {"scalar": 1.0, "samples": 50, "byCategory": {_CATEGORY: {"scalar": 1.30, "samples": 30}}}
    edge = correlation_edge(_block_legs(), model=model)
    assert edge["category"] == _CATEGORY
    assert edge["edgeRatio"] > 1.05  # shrunk 1.0->1.30 by 30 samples ~= 1.20
    assert edge["edgeDirection"] == "stake_underprices_correlation"
    assert edge["confidence"] == "measured"


def test_overcredited_category_is_flagged_avoid():
    model = {"scalar": 1.0, "samples": 50, "byCategory": {_CATEGORY: {"scalar": 0.70, "samples": 30}}}
    edge = correlation_edge(_block_legs(), model=model)
    assert edge["edgeRatio"] < 0.95
    assert edge["edgeDirection"] == "stake_overcredits_correlation"


def test_thin_sample_shrinks_toward_the_global_baseline():
    model = {"scalar": 1.0, "samples": 50, "byCategory": {_CATEGORY: {"scalar": 1.5, "samples": 2}}}
    edge = correlation_edge(_block_legs(), model=model)
    assert edge["confidence"] == "thin"
    assert 1.0 < edge["edgeRatio"] < 1.5  # not the raw 1.5 -- pulled toward 1.0


def test_quote_observation_carries_the_category():
    obs = quote_observation(_block_legs(), real_quote=3.0)
    assert obs is not None
    assert obs["correlationCategory"] == _CATEGORY


def test_fit_quote_model_buckets_by_category():
    obs = [
        {"realizedScalar": 1.2, "correlationCategory": "cat_a"},
        {"realizedScalar": 1.4, "correlationCategory": "cat_a"},
        {"realizedScalar": 0.8, "correlationCategory": "cat_b"},
    ]
    model = fit_quote_model(obs)
    assert model["byCategory"]["cat_a"]["samples"] == 2
    assert model["byCategory"]["cat_a"]["scalar"] == 1.3  # median(1.2, 1.4)
    assert model["byCategory"]["cat_b"]["samples"] == 1
    assert model["samples"] == 3


def test_ledger_round_trips_category_into_the_model(tmp_path):
    led = PickLedger(db_path=tmp_path / "l.sqlite")
    led.record_quote_observations(
        [
            {"productOdds": 10.0, "priorRepricingRatio": 0.8, "realQuote": 9.0,
             "realizedScalar": 1.2, "correlationCategory": "cat_x"},
            {"productOdds": 10.0, "priorRepricingRatio": 0.8, "realQuote": 9.5,
             "realizedScalar": 1.25, "correlationCategory": "cat_x"},
        ]
    )
    model = led.load_quote_model()
    assert model["samples"] == 2
    assert model["byCategory"]["cat_x"]["samples"] == 2


def test_block_carries_a_correlation_edge():
    block = build_block(_block_legs() + [_leg("g1", "C", "NY", "runs", "under")])
    assert block is not None
    assert "correlationEdge" in block
    assert "edgeRatio" in block["correlationEdge"]
    assert "edgeDirection" in block["correlationEdge"]
