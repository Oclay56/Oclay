from __future__ import annotations

import app.correlation as corr
import app.correlation_calibration as cc
from app.calibration import build_market_policies
from app.correlation_calibration import _phi


def test_market_policy_excludes_losing_market():
    rows = []
    for i in range(70):
        rows.append({"market_key": "home_runs", "odds": 4.0, "edge": 0.06,
                     "outcome": "win" if i < 11 else "loss"})
    for i in range(70):
        rows.append({"market_key": "hits", "odds": 1.9, "edge": 0.05,
                     "outcome": "win" if i < 42 else "loss"})
    policies = build_market_policies(rows)
    assert policies["home_runs"]["status"] == "exclude"
    assert policies["home_runs"]["realizedRoi"] < 0
    assert policies["hits"]["status"] == "ok"


def test_market_policy_insufficient_data_below_threshold():
    rows = [{"market_key": "rbi", "odds": 2.0, "edge": 0.05, "outcome": "loss"} for _ in range(10)]
    policies = build_market_policies(rows)
    assert policies["rbi"]["status"] == "insufficient_data"


def test_phi_coefficient_perfect_positive():
    # All pairs co-hit or co-miss -> phi = 1.
    assert abs(_phi(30, 0, 0, 30) - 1.0) < 1e-9


def test_phi_coefficient_independence_is_zero():
    assert abs(_phi(25, 25, 25, 25)) < 1e-9


def test_measured_correlation_blends_toward_prior_by_sample(monkeypatch):
    monkeypatch.setattr(cc, "_estimate_cache", {"loadedAt": 9e18,
        "estimates": {"same_player_same_family_same_dir": {"rho": 0.40, "samples": 120}}})
    # weight = 120/160 = 0.75 -> 0.25*0.62 + 0.75*0.40 = 0.455
    blended = corr.correlation_for_category("same_player_same_family_same_dir")
    assert abs(blended - 0.455) < 1e-3

    monkeypatch.setattr(cc, "_estimate_cache", {"loadedAt": 9e18,
        "estimates": {"same_player_same_family_same_dir": {"rho": 0.40, "samples": 4}}})
    blended_small = corr.correlation_for_category("same_player_same_family_same_dir")
    assert blended_small > blended  # tiny sample stays closer to the 0.62 prior
