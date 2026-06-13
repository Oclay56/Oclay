from __future__ import annotations

import asyncio

from app.grading import REASON_SEQUENCE, _pending_detail
from app.market_normalization import (
    OPTIONAL_SEQUENCE_MARKETS,
    SUPPORTED_MLB_PROP_MARKETS,
    is_optional_sequence_market,
    normalize_mlb_prop_market_key,
)
from app.mlb_bridge import stat_mapping_for_market
from app.thesis_blocks import is_sequence_leg


def test_stake_backend_keys_normalize_to_canonical():
    assert normalize_mlb_prop_market_key("first_h") == "first_hit"
    assert normalize_mlb_prop_market_key("first_r") == "first_run"
    assert normalize_mlb_prop_market_key("first_hr") == "first_home_run"


def test_spelled_out_first_markets_do_not_leak_into_counting_stats():
    # The dangerous case: display-name labels must NOT fall through to
    # hits / home_runs and get misgraded.
    assert normalize_mlb_prop_market_key("First Hit") == "first_hit"
    assert normalize_mlb_prop_market_key("First Home Run") == "first_home_run"
    assert normalize_mlb_prop_market_key("1st Run") == "first_run"


def test_first_markets_are_optional_not_supported():
    for key in ("first_h", "first_r", "first_hr"):
        assert is_optional_sequence_market(key)
    assert OPTIONAL_SEQUENCE_MARKETS.isdisjoint(SUPPORTED_MLB_PROP_MARKETS)
    # RBI and home runs remain standard, gradeable markets.
    assert not is_optional_sequence_market("rbi")
    assert not is_optional_sequence_market("home_runs")


def test_stat_mapping_flags_first_market_as_optional_ungradeable():
    mapping = stat_mapping_for_market("first_hr")
    assert mapping["supported"] is False
    assert mapping["gradeable"] is False
    assert mapping["marketClass"] == "optional_sequence"
    assert mapping["statKey"] is None
    # RBI maps to a real stat and is gradeable.
    rbi = stat_mapping_for_market("rbi")
    assert rbi["supported"] is True
    assert rbi["statKey"] == "rbi"


def test_first_markets_land_in_sequence_risk_class():
    assert is_sequence_leg({"normalizedMarketKey": "first_hit"})
    assert is_sequence_leg({"normalizedMarketKey": "first_home_run"})
    assert not is_sequence_leg({"normalizedMarketKey": "rbi"})


def test_logged_first_market_is_flagged_not_misgraded():
    # If a first-event leg is ever logged, grading must hold it under a clear,
    # attention-category reason -- never settle it as a counting-stat total.
    detail = _pending_detail(
        {"player": "A", "market_key": "first_hr", "side": "over", "line": 0.5, "slate_date": "2025-05-08"},
        REASON_SEQUENCE,
        today=__import__("datetime").date(2025, 5, 9),
    )
    assert detail["category"] == "attention"
    assert "first-event" in detail["reason"].lower()


def test_candidate_pool_holds_first_markets_out_of_picks():
    from app.sgm_candidate_pool import build_sgm_candidate_pool_from_boards
    from tests.test_sgm_candidate_pool import CandidateFakeMLBEngine, _fresh_captured_at, _row

    boards = [
        {
            "source": "stake_ui_sgm",
            "fixtureSlug": "fixture-a",
            "capturedAt": _fresh_captured_at(),
            "playerProps": [
                _row("Strong Hit", "Test A", "Hits", 1.8, fixture_slug="fixture-a"),
                _row("First HR", "Test B", "first_hr", 4.5, fixture_slug="fixture-a"),
            ],
            "teamMarkets": [],
        },
    ]
    result = asyncio.run(
        build_sgm_candidate_pool_from_boards(
            boards, CandidateFakeMLBEngine(), date="2026-05-25", side="over",
            mode="best_available", quality_floor=0, history_limit=15,
        )
    )
    optional = result["optionalSequenceMarkets"]
    assert optional["gradeable"] is False
    assert optional["count"] == 1
    assert optional["markets"][0]["normalizedMarketKey"] == "first_home_run"
    # And it never appears in the researched, rankable pick set.
    assert all(
        c.get("normalizedMarketKey") != "first_home_run"
        for c in result["rankedCandidates"]
    )
