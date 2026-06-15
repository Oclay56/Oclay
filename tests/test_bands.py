"""Adaptive band menu assembly (Phase 1, read-only)."""

from __future__ import annotations

from app.bands import assemble_bands


def _candidates():
    return [
        {
            "rowId": "r1",
            "player": "Aaron Judge",
            "team": "Yankees",
            "market": "total_bases",
            "side": "under",
            "line": 1.5,
            "odds": 1.9,
            "fixtureSlug": "yankees-redsox",
            "matchup": "Yankees vs Red Sox",
            "probabilityAssessment": {
                "edge": 0.06,
                "edgeStatus": "clear_possible_edge",
                "dataQuality": "high",
                "edgeRobustToUncertainty": True,
            },
            "sharpLineSignal": {"matched": True, "direction": "beats_sharp_consensus"},
        },
        {
            "rowId": "r2",
            "player": "Rafael Devers",
            "team": "Red Sox",
            "market": "hits",
            "side": "under",
            "line": 1.5,
            "odds": 2.0,
            "fixtureSlug": "yankees-redsox",
            "matchup": "Yankees vs Red Sox",
            "probabilityAssessment": {"edge": 0.03, "edgeStatus": "thin_edge", "dataQuality": "medium"},
            "staleLineSignal": {"isStale": True},
        },
        {
            "rowId": "r3",
            "player": "Bryce Harper",
            "team": "Phillies",
            "market": "total_bases",
            "side": "under",
            "line": 1.5,
            "odds": 1.95,
            "fixtureSlug": "phillies-marlins",
            "matchup": "Phillies vs Marlins",
            "probabilityAssessment": {"edge": 0.05, "edgeStatus": "clear_possible_edge", "dataQuality": "high"},
        },
    ]


def _blueprints():
    return {
        "frontierBand": {"min": 5.0, "max": 90000.0},
        "frontierNote": "ladder note",
        "frontier": [
            {
                "tier": "anchor",
                "tierRank": 1,
                "structure": "1-block",
                "productOdds": 12.0,
                "jointWinProbability": 0.28,
                "expectedValue": 0.04,
                "riskAdjustedValue": 0.9,
                "thesisTags": ["offense_shutdown"],
                "blocks": [
                    {"fixtureSlug": "yankees-redsox", "matchup": "Yankees vs Red Sox",
                     "thesisTag": "offense_shutdown", "payoutOdds": 12.0, "winProbability": 0.28,
                     "rowIds": ["r1", "r2"]},
                ],
            },
            {
                "tier": "moonshot",
                "tierRank": 2,
                "structure": "2-block",
                "productOdds": 88000.0,
                "jointWinProbability": 0.011,
                "expectedValue": -0.02,
                "riskAdjustedValue": 0.3,
                "thesisTags": ["offense_shutdown", "player_multistat"],
                "blocks": [
                    {"fixtureSlug": "yankees-redsox", "matchup": "Yankees vs Red Sox",
                     "thesisTag": "offense_shutdown", "payoutOdds": 60.0, "winProbability": 0.28,
                     "rowIds": ["r1", "r2"]},
                    {"fixtureSlug": "phillies-marlins", "matchup": "Phillies vs Marlins",
                     "thesisTag": "player_multistat", "payoutOdds": 1466.0, "winProbability": 0.04,
                     "rowIds": ["r3"]},
                ],
            },
        ],
    }


def test_assemble_bands_basic_shape():
    menu = assemble_bands(_blueprints(), _candidates())
    assert menu["bandCount"] == 2
    assert menu["maxReachableOdds"] == 88000.0
    assert menu["gamesUsed"] == ["phillies-marlins", "yankees-redsox"]
    assert set(b["tier"] for b in menu["bands"]) == {"anchor", "moonshot"}


def test_top_band_flagged_max_reachable():
    menu = assemble_bands(_blueprints(), _candidates())
    moonshot = next(b for b in menu["bands"] if b["tier"] == "moonshot")
    assert "max reachable" in moonshot["label"]
    anchor = next(b for b in menu["bands"] if b["tier"] == "anchor")
    assert anchor["label"] == "~12x"


def test_legs_resolved_and_grouped_by_game():
    menu = assemble_bands(_blueprints(), _candidates())
    moonshot = next(b for b in menu["bands"] if b["tier"] == "moonshot")
    games = {g["fixtureSlug"]: g for g in moonshot["legsByGame"]}
    assert set(games) == {"yankees-redsox", "phillies-marlins"}
    yankees_legs = games["yankees-redsox"]["legs"]
    assert {leg["player"] for leg in yankees_legs} == {"Aaron Judge", "Rafael Devers"}
    judge = next(leg for leg in yankees_legs if leg["player"] == "Aaron Judge")
    assert judge["edge"] == 0.06
    assert "beats_sharp" in judge["why"]
    assert "clear_possible_edge" in judge["why"]


def test_exposure_readout():
    menu = assemble_bands(_blueprints(), _candidates())
    moonshot = next(b for b in menu["bands"] if b["tier"] == "moonshot")
    exp = moonshot["exposure"]
    assert exp["legCount"] == 3
    assert exp["byMarket"] == {"total_bases": 2, "hits": 1}
    assert exp["distinctPlayers"] == 3
    assert exp["distinctGames"] == 2
    assert exp["topMarket"] == "total_bases"
    assert exp["topMarketShare"] == round(2 / 3, 2)


def test_buildable_true_when_all_legs_resolve():
    menu = assemble_bands(_blueprints(), _candidates())
    assert all(b["buildable"] for b in menu["bands"])
    assert all(b["unresolvedLegs"] == 0 for b in menu["bands"])


def test_buildable_false_when_a_row_id_is_missing():
    # Drop r3 so the moonshot band has an unresolvable leg.
    cands = [c for c in _candidates() if c["rowId"] != "r3"]
    menu = assemble_bands(_blueprints(), cands)
    moonshot = next(b for b in menu["bands"] if b["tier"] == "moonshot")
    assert moonshot["buildable"] is False
    assert moonshot["unresolvedLegs"] == 1
    # the anchor band (r1+r2) is still fully resolved -> buildable
    anchor = next(b for b in menu["bands"] if b["tier"] == "anchor")
    assert anchor["buildable"] is True


def test_empty_frontier_is_safe():
    menu = assemble_bands({"frontier": []}, [])
    assert menu["bandCount"] == 0
    assert menu["maxReachableOdds"] is None
    assert menu["bands"] == []


def test_handles_none_inputs():
    menu = assemble_bands(None, None)
    assert menu["bandCount"] == 0
    assert menu["bands"] == []
