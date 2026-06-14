"""Dominance pruning + Pareto-frontier ladder.

The frontier is the formal answer to "which combinations make sense": out of
thousands of possible slips, keep only the non-dominated ones (each the best win
probability achievable at its payout), surfaced as a labeled ladder from anchor
(safest) to moonshot (max payout). The moonshot rung is always preserved, so the
longshot style is kept -- just built optimally.
"""

from __future__ import annotations

from app.thesis_blocks import (
    assemble_frontier,
    block_variants,
    build_block,
    build_slip_blueprints,
    build_variant_blocks,
    pareto_frontier,
)


def _leg(fix, player, team, market, side, line, odds, prob):
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
    }


def _slate(n_games=8):
    """A multi-game board with two priced players per game."""
    legs = []
    for g in range(n_games):
        fix = f"g{g}"
        legs += [
            _leg(fix, f"P{g}a", "AA", "hits", "under", 1.5, 1.9, 0.58),
            _leg(fix, f"P{g}a", "AA", "total_bases", "under", 1.5, 2.0, 0.56),
            _leg(fix, f"P{g}b", "BB", "batter_strikeouts", "over", 0.5, 1.85, 0.57),
        ]
    return legs


# ---- pareto_frontier unit logic -------------------------------------------
def test_pareto_drops_dominated_slips():
    bps = [
        {"jointWinProbability": 0.20, "productOdds": 1000.0, "riskAdjustedValue": 0.1},
        # dominated: lower prob AND lower odds than the first.
        {"jointWinProbability": 0.15, "productOdds": 800.0, "riskAdjustedValue": 0.0},
        # non-dominated: less likely but pays much more.
        {"jointWinProbability": 0.05, "productOdds": 50000.0, "riskAdjustedValue": -0.2},
    ]
    frontier = pareto_frontier(bps)
    odds = {bp["productOdds"] for bp in frontier}
    assert odds == {1000.0, 50000.0}  # the dominated 800x slip is gone
    # Sorted ascending by payout.
    assert [bp["productOdds"] for bp in frontier] == [1000.0, 50000.0]


def test_pareto_collapses_exact_ties_to_best_constructed():
    bps = [
        {"jointWinProbability": 0.10, "productOdds": 5000.0, "riskAdjustedValue": -0.5},
        {"jointWinProbability": 0.10, "productOdds": 5000.0, "riskAdjustedValue": -0.1},
    ]
    frontier = pareto_frontier(bps)
    assert len(frontier) == 1
    assert frontier[0]["riskAdjustedValue"] == -0.1  # kept the better-built one


# ---- block variants --------------------------------------------------------
def test_block_variants_are_a_nested_safe_to_aggressive_menu():
    block = build_block(
        [
            _leg("g1", "A", "AA", "hits", "under", 1.5, 1.9, 0.58),
            _leg("g1", "B", "BB", "total_bases", "under", 1.5, 2.0, 0.56),
            _leg("g1", "C", "AA", "batter_strikeouts", "over", 0.5, 1.85, 0.57),
        ]
    )
    assert block is not None
    variants = block_variants(block)
    if len(variants) > 1:
        # More legs -> higher odds, lower win probability (a real ladder).
        odds = [v["payoutOdds"] for v in variants]
        probs = [v["winProbability"] for v in variants]
        assert odds == sorted(odds)
        assert probs == sorted(probs, reverse=True)
        assert variants[-1]["variantLegCount"] == block["legCount"]


# ---- end-to-end frontier ---------------------------------------------------
def test_frontier_is_a_non_dominated_labeled_ladder():
    variants = build_variant_blocks(_slate(8))
    ladder = assemble_frontier(variants, min_odds=100.0, max_odds=250_000.0)
    assert ladder, "expected a non-empty frontier ladder"

    # Sorted ascending by payout, strictly non-dominated.
    odds = [bp["productOdds"] for bp in ladder]
    assert odds == sorted(odds)
    for i, a in enumerate(ladder):
        for j, b in enumerate(ladder):
            if i == j:
                continue
            # No rung is beaten in BOTH dimensions by another.
            assert not (
                b["jointWinProbability"] >= a["jointWinProbability"]
                and b["productOdds"] >= a["productOdds"]
                and (
                    b["jointWinProbability"] > a["jointWinProbability"]
                    or b["productOdds"] > a["productOdds"]
                )
            )

    # The longshot is preserved: the top rung is the highest payout and tagged.
    assert ladder[-1]["tier"] == "moonshot"
    assert ladder[-1]["productOdds"] == max(odds)
    assert ladder[0]["tier"] in {"anchor", "moonshot"}


def test_frontier_respects_the_target_band():
    blueprints = build_slip_blueprints(
        _slate(10), target_odds_min=5_000.0, target_odds_max=200_000.0
    )
    frontier = blueprints["frontier"]
    assert frontier, "expected band-constrained frontier rungs"
    for bp in frontier:
        assert 5_000.0 <= bp["productOdds"] <= 200_000.0
    # Frontier metadata is surfaced for the GPT.
    assert blueprints["frontierBand"] == {"min": 5_000.0, "max": 200_000.0}
    assert "moonshot" in {bp["tier"] for bp in frontier} or len(frontier) == 1
