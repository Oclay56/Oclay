from __future__ import annotations

from app.thesis_blocks import (
    BLOCK_MAX_ODDS,
    MARKET_TYPE_HARD_CAP,
    SEQUENCE_PER_BLOCK_CAP,
    assemble_to_target,
    build_block,
    build_slip_blueprints,
    is_sequence_leg,
    label_block,
    rank_blocks,
)


def _leg(fix, player, team, market, side, line, odds, prob, **extra):
    return {
        "fixtureSlug": fix,
        "matchup": fix,
        "player": player,
        "team": team,
        "normalizedMarketKey": market,
        "side": side,
        "line": line,
        "odds": odds,
        "rowId": f"{fix}:{player}:{market}:{side}",
        "probabilityAssessment": {"estimatedProbability": prob},
        **extra,
    }


def _ace_game():
    return [
        _leg("g1", "Pitcher A", "TX", "strikeouts", "over", 6.5, 1.8, 0.60),
        _leg("g1", "Hitter X", "NY", "hits", "under", 0.5, 2.0, 0.55),
        _leg("g1", "Hitter Y", "NY", "total_bases", "under", 1.5, 1.9, 0.58),
    ]


def test_is_sequence_leg_detects_lottery_and_first_props():
    assert is_sequence_leg(_leg("g", "p", "t", "home_runs", "over", 0.5, 4.0, 0.3))
    assert is_sequence_leg(_leg("g", "p", "t", "stolen_bases", "over", 0.5, 3.0, 0.3))
    # Name-based detection for first-X markets that route through a counting stat.
    first_hit = _leg("g", "p", "t", "hits", "over", 0.5, 5.0, 0.3)
    first_hit["market"] = {"name": "First Hit of Game"}
    assert is_sequence_leg(first_hit)
    assert not is_sequence_leg(_leg("g", "p", "t", "hits", "over", 0.5, 1.8, 0.6))


def test_build_block_respects_guardrails():
    block = build_block(_ace_game())
    assert block is not None
    assert 2 <= block["legCount"] <= 16
    assert block["payoutOdds"] <= BLOCK_MAX_ODDS
    assert block["withinGuardrails"] is True
    # One leg per player.
    players = [leg["player"] for leg in block["legs"]]
    assert len(players) == len(set(players))


def test_market_type_hard_cap_limits_one_stat_family():
    # Ten cheap hits-overs from one game; the cap must stop the block from
    # becoming a single market type (balance fix #1).
    legs = [
        _leg("g1", f"Player {i}", "LA", "hits", "over", 0.5, 1.5, 0.66)
        for i in range(10)
    ]
    block = build_block(legs)
    assert block is not None
    assert block["marketMix"].get("hits", 0) <= MARKET_TYPE_HARD_CAP


def test_sequence_legs_capped_per_block():
    legs = [
        _leg("g1", "Slug 1", "LA", "home_runs", "over", 0.5, 4.0, 0.30),
        _leg("g1", "Slug 2", "LA", "home_runs", "over", 0.5, 4.5, 0.28),
        _leg("g1", "Slug 3", "LA", "home_runs", "over", 0.5, 5.0, 0.26),
        _leg("g1", "Bat 1", "LA", "total_bases", "over", 1.5, 1.7, 0.62),
        _leg("g1", "Bat 2", "LA", "hits", "over", 0.5, 1.6, 0.64),
    ]
    block = build_block(legs)
    assert block is not None
    assert block["sequenceLegs"] <= SEQUENCE_PER_BLOCK_CAP


def test_assemble_to_target_lands_in_band_and_is_dynamic():
    # Three games, each a 2-leg block; the search must pick a block count whose
    # product lands in the band -- not a fixed power formula.
    blocks = []
    for fix in ("g1", "g2", "g3"):
        legs = [
            _leg(fix, f"{fix} A", "AA", "hits", "over", 0.5, 1.7, 0.62),
            _leg(fix, f"{fix} B", "BB", "total_bases", "over", 1.5, 1.8, 0.58),
        ]
        block = build_block(legs)
        assert block is not None
        blocks.append(block)

    blueprints = assemble_to_target(blocks, target_min=5.0, target_max=20.0)
    assert blueprints
    for bp in blueprints:
        assert 5.0 <= bp["productOdds"] <= 20.0
        assert bp["blockCount"] == len(bp["blocks"])
        # Each block is from a distinct game.
        fixtures = [b["fixtureSlug"] for b in bp["blocks"]]
        assert len(fixtures) == len(set(fixtures))


def test_concentration_penalty_prefers_diversified_slip():
    # Two same-direction offense blocks (concentrated) vs one offense + one
    # ace-suppression block (diversified) at comparable odds. The diversified
    # slip should win on risk-adjusted value even if raw probability is close.
    offense_a = build_block([
        _leg("g1", "A1", "LA", "hits", "over", 0.5, 1.7, 0.63),
        _leg("g1", "A2", "LA", "total_bases", "over", 1.5, 1.8, 0.60),
    ])
    offense_b = build_block([
        _leg("g2", "B1", "NY", "hits", "over", 0.5, 1.7, 0.63),
        _leg("g2", "B2", "NY", "total_bases", "over", 1.5, 1.8, 0.60),
    ])
    suppression = build_block([
        _leg("g3", "Ace", "TX", "strikeouts", "over", 6.5, 1.7, 0.63),
        _leg("g3", "Opp", "SF", "hits", "under", 0.5, 1.8, 0.60),
    ])
    blueprints = assemble_to_target(
        [offense_a, offense_b, suppression], target_min=2.0, target_max=12.0
    )
    two_block = [bp for bp in blueprints if bp["blockCount"] == 2]
    assert two_block
    top = max(two_block, key=lambda bp: bp["riskAdjustedValue"])
    # The winning 2-block slip is not the all-offense pair.
    assert top["concentration"] < 1.0


def test_marginal_contribution_shows_compounding_cost():
    blocks = [
        build_block([
            _leg(f, f"{f}1", "AA", "hits", "over", 0.5, 1.7, 0.62),
            _leg(f, f"{f}2", "BB", "total_bases", "over", 1.5, 1.8, 0.58),
        ])
        for f in ("g1", "g2", "g3")
    ]
    blueprints = assemble_to_target(blocks, target_min=3.0, target_max=60.0, top_n=5)
    multi = [bp for bp in blueprints if bp["blockCount"] >= 2][0]
    contributions = multi["marginalContribution"]
    assert len(contributions) == multi["blockCount"]
    for c in contributions:
        # Adding a block always lowers the joint win probability.
        assert c["winProbabilityCost"] <= 0
        assert c["oddsMultiplier"] > 1.0


def test_label_block_maps_thesis():
    label = label_block(_ace_game())
    assert label["thesisTag"] in {"ace_suppression", "offense_shutdown", "mixed_game_script"}
    assert isinstance(label["thesis"], str) and label["thesis"]


def test_rank_blocks_excludes_killed_thesis():
    block = build_block(_ace_game())
    tag = block["thesisTag"]
    ranked = rank_blocks([block], thesis_policies={tag: {"status": "exclude", "realizedRoi": -0.2}})
    assert ranked == []
    kept = rank_blocks([block], thesis_policies={tag: {"status": "ok", "realizedRoi": 0.1}})
    assert len(kept) == 1
    assert kept[0]["thesisPolicy"]["status"] == "ok"


def test_build_slip_blueprints_reports_unreachable_band():
    # A single small block cannot reach a 50k target; the engine says so rather
    # than padding with junk.
    ranked = [
        _leg("g1", "A", "AA", "hits", "over", 0.5, 1.7, 0.62),
        _leg("g1", "B", "BB", "total_bases", "over", 1.5, 1.8, 0.58),
    ]
    out = build_slip_blueprints(ranked, target_odds_min=50000, target_odds_max=60000)
    assert out["bandBlueprints"] == []
    assert out["bandNote"] is not None
    assert "tops out" in out["bandNote"]
    # But an EV-max blueprint is still offered.
    assert out["evMaxBlueprint"] is not None
