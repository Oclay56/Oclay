from __future__ import annotations

from app.correlation import (
    leg_correlation_penalty,
    leg_pair_correlation,
    slip_probability_and_ev,
)
from app.correlation import _single_factor_joint_probability


def _leg(player, market, side="over", odds=1.9, prob=0.6, fixture="reds-astros", team="Astros"):
    return {
        "fixtureSlug": fixture,
        "player": player,
        "team": team,
        "normalizedMarketKey": market,
        "side": side,
        "odds": odds,
        "winProbability": prob,
    }


def test_copula_recovers_independence_at_zero_correlation():
    joint = _single_factor_joint_probability([0.6, 0.6, 0.6], 0.0)
    assert abs(joint - 0.6**3) < 1e-6


def test_copula_lifts_joint_probability_for_positive_correlation():
    independent = 0.6**3
    correlated = _single_factor_joint_probability([0.6, 0.6, 0.6], 0.62)
    assert correlated > independent
    # As correlation approaches 1 the joint approaches the weakest leg.
    near_perfect = _single_factor_joint_probability([0.6, 0.6, 0.6], 0.999)
    assert abs(near_perfect - 0.6) < 0.02


def test_same_player_same_family_is_strongly_correlated():
    a = _leg("Jose Altuve", "hits")
    b = _leg("Jose Altuve", "total_bases")
    assert leg_pair_correlation(a, b) > 0.5


def test_opposite_directions_same_player_are_negatively_correlated():
    a = _leg("Jose Altuve", "hits", side="over")
    b = _leg("Jose Altuve", "total_bases", side="under")
    assert leg_pair_correlation(a, b) < 0


def test_different_games_are_independent():
    a = _leg("Jose Altuve", "hits", fixture="reds-astros")
    b = _leg("Aaron Judge", "hits", fixture="yankees-rays")
    assert leg_pair_correlation(a, b) == 0.0


def test_correlation_penalty_taxes_redundant_same_player_leg():
    strong = _leg("Jose Altuve", "hits")
    redundant = _leg("Jose Altuve", "total_bases")
    result = leg_correlation_penalty(redundant, [strong])
    assert result["penalty"] > 0
    assert result["driverPlayer"] == "jose-altuve"


def test_slip_ev_uses_real_payout_and_correlation():
    legs = [
        _leg("Jose Altuve", "hits", odds=1.8, prob=0.6),
        _leg("Jose Altuve", "total_bases", odds=2.0, prob=0.55),
        _leg("Other Guy", "hits", odds=1.7, prob=0.62, team="Reds"),
    ]
    result = slip_probability_and_ev(legs)
    assert result["fullyPriced"] is True
    assert result["estimatedWinProbability"] > result["independenceWinProbability"]
    assert result["expectedValue"] is not None
    assert result["rawProductOdds"] == round(1.8 * 2.0 * 1.7, 4)


def test_slip_ev_handles_unpriced_legs_gracefully():
    legs = [{"fixtureSlug": "x", "player": "A", "normalizedMarketKey": "hits", "side": "over"}]
    result = slip_probability_and_ev(legs)
    assert result["fullyPriced"] is False
    assert result["estimatedWinProbability"] is None
