from __future__ import annotations

import math

from app.probability_engine import (
    apply_calibration_correction,
    apply_matchup_shift,
    devig_two_way,
    distributional_line_probability,
    effective_sample_size,
    estimate_side_probability,
    probability_confidence_interval,
    shrink_recent_rate,
)


def test_thin_samples_get_wider_intervals_than_full_samples():
    thin = probability_confidence_interval(0.62, effective_sample_size(5, 0))
    full = probability_confidence_interval(0.62, effective_sample_size(15, 60))
    assert thin["width"] > full["width"]
    # The conservative (lower) bound is far more pessimistic on thin data.
    assert thin["conservativeProbability"] < full["conservativeProbability"]
    assert full["low"] < 0.62 < full["high"]


def test_effective_sample_caps_season_contribution():
    # A huge season cannot make the estimate look near-certain.
    capped = effective_sample_size(0, 500)
    assert capped <= effective_sample_size(0, 50) + 1e-9


def test_distributional_probability_matches_poisson_limit():
    # With high dispersion the negative binomial approaches Poisson.
    # P(X >= 1 | mean 1.0) ~ 1 - e^-1 = 0.632.
    result = distributional_line_probability(
        1.0, 0.5, "over", dispersion=1000.0
    )
    assert abs(result["winProbability"] - (1 - math.exp(-1))) < 0.01
    assert result["pushProbability"] == 0.0


def test_distributional_over_under_partition_half_line():
    over = distributional_line_probability(1.4, 1.5, "over", market_key="hits")
    under = distributional_line_probability(1.4, 1.5, "under", market_key="hits")
    assert abs(over["winProbability"] + under["winProbability"] - 1.0) < 1e-3


def test_distributional_integer_line_has_push_mass():
    result = distributional_line_probability(6.0, 6.0, "over", market_key="strikeouts")
    assert result["pushProbability"] > 0.0
    # over + push + under must equal 1.
    under = distributional_line_probability(6.0, 6.0, "under", market_key="strikeouts")
    total = result["winProbability"] + result["pushProbability"] + under["winProbability"]
    assert abs(total - 1.0) < 1e-2


def test_devig_two_way_removes_overround():
    result = devig_two_way(1.55, 2.25)
    assert result["method"] == "two_way_multiplicative_devig"
    assert result["overround"] > 0
    # Fair probability is below raw implied because vig is removed.
    assert result["fairProbability"] < result["impliedProbability"]


def test_devig_falls_back_without_opposite_side():
    result = devig_two_way(1.9, None)
    assert result["method"] == "raw_implied_vig_not_removed"
    assert result["fairProbability"] == result["impliedProbability"]


def test_shrinkage_pulls_small_samples_toward_prior():
    # A hot 3-game sample (1.0) is shrunk hard toward a 0.5 prior.
    shrunk = shrink_recent_rate(1.0, 3, 0.5)
    assert 0.5 < shrunk["blendedRate"] < 0.75
    # A large 30-game sample dominates.
    big = shrink_recent_rate(1.0, 30, 0.5)
    assert big["blendedRate"] > shrunk["blendedRate"]


def test_matchup_shift_is_directional():
    up = apply_matchup_shift(0.5, 0.65)
    down = apply_matchup_shift(0.5, 0.35)
    assert up["probability"] > 0.5 > down["probability"]
    neutral = apply_matchup_shift(0.5, 0.5)
    assert neutral["probability"] == 0.5


def test_calibration_identity_map_is_noop():
    result = apply_calibration_correction(0.6, {"intercept": 0.0, "slope": 1.0, "samples": 500})
    assert abs(result["probability"] - 0.6) < 1e-3


def test_calibration_correction_shifts_overconfident_market():
    # A market the model overrates: slope < 1, negative intercept pulls high
    # predictions down. With enough samples the correction bites.
    correction = {"intercept": -0.4, "slope": 0.7, "samples": 100000}
    result = apply_calibration_correction(0.8, correction)
    assert result["applied"] is True
    assert result["probability"] < 0.8


def test_estimate_pipeline_produces_bounded_probability():
    estimate = estimate_side_probability(
        season_mean=1.1,
        line=0.5,
        side="over",
        market_key="hits",
        recent_rate=0.7,
        recent_games=15,
        matchup_factor=0.58,
        calibration=None,
    )
    assert estimate is not None
    assert 0.0 < estimate["estimatedProbability"] < 1.0
    assert estimate["distributional"]["distribution"] == "negative_binomial"
