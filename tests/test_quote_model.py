from __future__ import annotations

import pytest

from app.quote_model import (
    fit_quote_model,
    invalidate_quote_model_cache,
    predict_sgm_quote,
    quote_observation,
    slip_projection,
)


@pytest.fixture(autouse=True)
def _isolate_quote_model(monkeypatch):
    # These are unit tests of the pure prior; keep them independent of whatever
    # learned scalar the real local ledger happens to hold.
    monkeypatch.setenv("OCLAY_DISABLE_QUOTE_MODEL", "1")
    invalidate_quote_model_cache()
    yield
    invalidate_quote_model_cache()


def _legs(*specs):
    legs = []
    for player, market, odds, prob in specs:
        legs.append({
            "fixtureSlug": "g1", "player": player, "normalizedMarketKey": market,
            "side": "over", "odds": odds, "winProbability": prob,
        })
    return legs


def test_predicted_quote_is_below_product_for_correlated_legs():
    # Two strongly-correlated same-player legs: Stake reprices below the product.
    legs = _legs(("A", "hits", 2.0, 0.6), ("A", "total_bases", 2.2, 0.55))
    pred = predict_sgm_quote(legs)
    assert pred["predictedQuote"] < pred["productOdds"]
    assert pred["repricingRatio"] < 1.0
    assert pred["correlationTax"] > 0


def test_slip_projection_scores_ev_at_predicted_quote():
    legs = _legs(("A", "hits", 2.0, 0.6), ("B", "strikeouts", 1.8, 0.62))
    proj = slip_projection(legs)
    # EV at the predicted (lower) quote is no better than EV at the raw product.
    assert proj["expectedValue"] <= proj["productExpectedValue"] + 1e-9
    assert proj["predictedQuote"] is not None


def test_quote_observation_and_fit_recover_scalar():
    legs = _legs(("A", "hits", 2.0, 0.6), ("A", "total_bases", 2.2, 0.55))
    prior = predict_sgm_quote(legs)
    # Real quotes consistently 12% above the prior prediction.
    obs = [quote_observation(legs, prior["predictedQuote"] * 1.12) for _ in range(40)]
    fit = fit_quote_model([o for o in obs if o])
    assert fit["samples"] == 40
    assert abs(fit["scalar"] - 1.12) < 0.02


def test_unpriced_legs_fall_back_to_product():
    legs = [{"fixtureSlug": "g", "player": "A", "normalizedMarketKey": "hits", "side": "over"}]
    pred = predict_sgm_quote(legs)
    assert pred["method"] == "product_no_correlation_signal"
