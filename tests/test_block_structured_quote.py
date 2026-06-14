from __future__ import annotations

from app.correlation import slip_probability_and_ev
from app.quote_model import predict_sgm_quote


def _leg(fix, player, market, prob, odds, side="over"):
    return {
        "fixtureSlug": fix,
        "player": player,
        "normalizedMarketKey": market,
        "side": side,
        "winProbability": prob,
        "odds": odds,
    }


def test_blocks_are_independent_across_games():
    # Two games, each a pair of correlated same-player legs.
    g1 = [_leg("g1", "A", "hits", 0.6, 1.8), _leg("g1", "A", "total_bases", 0.6, 1.8)]
    g2 = [_leg("g2", "B", "hits", 0.6, 1.8), _leg("g2", "B", "total_bases", 0.6, 1.8)]

    j1 = slip_probability_and_ev(g1)["estimatedWinProbability"]
    j2 = slip_probability_and_ev(g2)["estimatedWinProbability"]
    combined = slip_probability_and_ev(g1 + g2)

    # The two games are priced as independent blocks: joint == j1 * j2.
    assert combined["blockCount"] == 2
    assert abs(combined["estimatedWinProbability"] - j1 * j2) < 1e-3
    # A single game still couples its own legs (one block).
    assert slip_probability_and_ev(g1)["blockCount"] == 1


def test_independent_games_get_no_correlation_tax():
    # One leg in each of four different games -> fully independent -> the
    # predicted Stake quote should be the full product (ratio ~1), NOT taxed
    # down toward the floor the way a single over-coupled blob would be.
    spread = [_leg(f"g{i}", f"P{i}", "hits", 0.55, 1.9) for i in range(4)]
    q = predict_sgm_quote(spread, model={})
    assert q["repricingRatio"] >= 0.99
    assert abs(q["predictedQuote"] - q["productOdds"]) < 1e-6


def test_spreading_across_games_lifts_the_predicted_quote():
    # Same four legs, same prices. Stacked in ONE game they get a correlation
    # tax; spread across four games they don't -> the multi-game quote is higher.
    spread = [_leg(f"g{i}", f"P{i}", "hits", 0.55, 1.9) for i in range(4)]
    one_game = [dict(leg, fixtureSlug="solo") for leg in spread]

    q_spread = predict_sgm_quote(spread, model={})
    q_one = predict_sgm_quote(one_game, model={})

    assert q_spread["repricingRatio"] >= q_one["repricingRatio"]
    assert q_spread["predictedQuote"] >= q_one["predictedQuote"]
