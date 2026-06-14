from __future__ import annotations

from app.matchup_model import log5_rate, sharpen_mean


def test_log5_returns_input_for_average_rates():
    assert abs(log5_rate(0.22, 0.22, 0.22) - 0.22) < 1e-6


def test_log5_amplifies_two_high_rates():
    assert log5_rate(0.30, 0.30, 0.22) > 0.30


def test_handedness_platoon_lifts_mean_vs_favorable_hand():
    candidate = {
        "normalizedMarketKey": "hits",
        "opponentPitcherContext": {"status": "available", "pitcher": {"pitchHand": "L"}},
        "playerSplits": {
            "seasonSplits": [
                {"split": {"code": "vr"}, "stats": {"ops": 0.700, "gamesPlayed": 80}},
                {"split": {"code": "vl"}, "stats": {"ops": 0.950, "gamesPlayed": 40}},
            ]
        },
        "season": {"average": 1.0, "total": 70},
        "seasonSample": {"plateAppearances": 400, "games": 100},
    }
    result = sharpen_mean(1.0, market_key="hits", candidate=candidate)
    assert result is not None
    platoon = next(a for a in result["adjustments"] if a["source"] == "handedness_platoon")
    assert platoon["factor"] > 1.0
    assert result["mean"] > 1.0


def test_lineup_top_spot_lifts_pa_volume_mean():
    # A 2-hole slot turns over more PA than the player's season baseline (3.8/g),
    # so the per-game mean for a PA-volume market scales up.
    candidate = {
        "normalizedMarketKey": "hits",
        "lineupContext": {"battingOrder": 2},
        "seasonSample": {"plateAppearances": 380, "games": 100},  # 3.8 PA/g baseline
    }
    result = sharpen_mean(1.0, market_key="hits", candidate=candidate)
    assert result is not None
    lineup = next(a for a in result["adjustments"] if a["source"] == "lineup_spot_pa_volume")
    assert lineup["battingOrder"] == 2
    assert lineup["factor"] > 1.0
    assert result["mean"] > 1.0


def test_lineup_bottom_spot_cuts_pa_volume_mean():
    candidate = {
        "normalizedMarketKey": "total_bases",
        "lineupContext": {"battingOrder": 9},
        "seasonSample": {"plateAppearances": 440, "games": 100},  # 4.4 PA/g baseline
    }
    result = sharpen_mean(1.5, market_key="total_bases", candidate=candidate)
    assert result is not None
    lineup = next(a for a in result["adjustments"] if a["source"] == "lineup_spot_pa_volume")
    assert lineup["factor"] < 1.0
    assert result["mean"] < 1.5


def test_lineup_pa_factor_does_not_apply_to_non_pa_markets():
    # runs/rbi lineup dependence is opportunity, not raw PA -> handled elsewhere.
    candidate = {
        "normalizedMarketKey": "rbi",
        "lineupContext": {"battingOrder": 1},
        "seasonSample": {"plateAppearances": 380, "games": 100},
    }
    result = sharpen_mean(0.8, market_key="rbi", candidate=candidate)
    assert result is None or not any(
        a["source"] == "lineup_spot_pa_volume" for a in result["adjustments"]
    )


def test_park_factor_applies_for_known_venue():
    candidate = {
        "normalizedMarketKey": "home_runs",
        "gameContext": {"venue": {"name": "Coors Field"}},
        "season": {"average": 0.3},
    }
    result = sharpen_mean(0.3, market_key="home_runs", candidate=candidate)
    assert result is not None
    park = next(a for a in result["adjustments"] if a["source"] == "park_factor")
    assert park["factor"] > 1.0


def test_log5_batter_strikeouts_builds_combined_mean():
    candidate = {
        "normalizedMarketKey": "batter-strikeouts",
        "opponentPitcherContext": {
            "status": "available",
            "season": {
                "strikeOuts": 200,
                "inningsPitched": 180.0,
                "hitsAllowed": 150,
                "walksAllowed": 50,
            },
        },
        "season": {"average": 1.2, "total": 130},
        "seasonSample": {"plateAppearances": 500, "games": 120},
    }
    result = sharpen_mean(1.2, market_key="batter-strikeouts", candidate=candidate)
    assert result is not None
    log5 = next(a for a in result["adjustments"] if a["source"] == "log5_batter_strikeouts")
    assert 0.0 < log5["combinedKRatePerPA"] < 1.0


def test_weather_boosts_home_runs_on_hot_day_with_wind_out():
    candidate = {
        "normalizedMarketKey": "home-runs",
        "gameContext": {"venue": {"name": "X"}, "weather": {"temp": "88 °F", "wind": "15 mph, Out To CF"}},
        "season": {"average": 0.3},
    }
    result = sharpen_mean(0.3, market_key="home-runs", candidate=candidate)
    weather = next(a for a in result["adjustments"] if a["source"] == "weather")
    assert weather["factor"] > 1.0
    assert result["mean"] > 0.3


def test_weather_suppresses_on_cold_day_with_wind_in():
    candidate = {
        "normalizedMarketKey": "home-runs",
        "gameContext": {"venue": {"name": "X"}, "weather": {"temp": "48 °F", "wind": "12 mph, In From CF"}},
        "season": {"average": 0.3},
    }
    result = sharpen_mean(0.3, market_key="home-runs", candidate=candidate)
    weather = next(a for a in result["adjustments"] if a["source"] == "weather")
    assert weather["factor"] < 1.0


def test_no_adjustments_returns_none():
    assert sharpen_mean(1.0, market_key="hits", candidate={}) is None
