"""Lean-by-default response shaping: the GPT gets a small decision packet, with
the heavy audit/diagnostics one flag away (verbose / compact=false). These guard
that the lean path actually drops the bulk while keeping the decision-critical
fields, and that the verbose path still returns everything."""

from __future__ import annotations

from app.main import (
    _lean_batch_review_slip_result,
    _lean_review_slip_result,
    _lean_ui_state,
)
from app.real_quote import real_quote_ev
from app.sgm_candidate_pool import (
    _compact_candidate_pool_row,
    compact_sgm_candidate_pool_response,
)


def _full_pool() -> dict:
    return {
        "source": "stake_ui_sgm_candidate_pool",
        "decisionOwner": "custom_gpt",
        "mode": "best_available",
        "date": "2026-06-14",
        "candidateCounts": {"scannedRows": 450, "returnedRows": 12},
        "guardrails": {"maxSgmGroupOdds": 501},
        "rejectedSummary": {"insufficient_researched_data": 3},
        "marketPolicy": {"killedMarkets": ["batter_walks"], "active": True, "downweightedRows": 2},
        "marketExposure": {"hits": 4, "total_bases": 3},
        "rankedCandidates": [
            {
                "fixtureSlug": "f1",
                "rowId": "row-1",
                "player": "Aaron Judge",
                "market": "Total Bases",
                "side": "over",
                "line": 1.5,
                "odds": 1.9,
                "score": 71.0,
                "selectionProof": {"selectedMarket": "total_bases", "marketsCompared": 5},
                "probabilityAssessment": {"edgeStatus": "edge", "inputs": {"matchupFactor": 1.1}},
            }
        ],
        "slipBlueprints": {
            "targetBand": {"min": 50000, "max": 60000},
            "blocks": [
                {
                    "fixtureSlug": "f1",
                    "thesis": "judge-heavy",
                    "legCount": 3,
                    "rowIds": ["row-1", "row-2", "row-3"],
                    "winProbability": 0.02,
                    "payoutOdds": 250.0,
                    "legs": [{"big": "x" * 500}],  # heavy per-leg payload
                }
            ],
        },
        # --- heavy diagnostics that must NOT survive compaction ---
        "perGame": {"f1": {"projections": list(range(200))}},
        "slipProjections": {"a": 1},
        "portfolioExposure": {"b": 2},
        "lineCurveContest": {"contestedGroups": 7, "valueLeaders": list(range(15))},
        "marketContest": {"playerGroups": 30},
        "gameContest": {"x": 1},
        "contextCoverage": {"y": 2},
        "fullSlateComparison": {"note": "z" * 400},
        "researchCoverage": {"allReturnedRowsResearched": True},
        "notes": [
            "Candidate pool is support data only; the Custom GPT owns final selections.",
            "Stake rate-limited the SGM board reads -- cool down and scan fewer games.",
        ],
    }


def test_compact_pool_keeps_decision_keys_and_drops_heavy_diagnostics():
    compact = compact_sgm_candidate_pool_response(_full_pool())

    # Decision packet present.
    assert compact["compact"] is True
    assert compact["candidateCounts"]["returnedRows"] == 12
    assert compact["marketPolicy"]["killedMarkets"] == ["batter_walks"]
    assert compact["rejectedSummary"]["insufficient_researched_data"] == 3
    assert compact["rankedCandidates"][0]["rowId"] == "row-1"
    # Blueprint blocks keep row IDs / win prob / payout but drop the heavy legs.
    block = compact["slipBlueprints"]["blocks"][0]
    assert block["rowIds"] == ["row-1", "row-2", "row-3"]
    assert block["winProbability"] == 0.02
    assert "legs" not in block

    # Heavy diagnostics gone from the top level...
    for key in (
        "perGame",
        "slipProjections",
        "portfolioExposure",
        "lineCurveContest",
        "marketContest",
        "gameContest",
        "contextCoverage",
        "fullSlateComparison",
        "researchCoverage",
    ):
        assert key not in compact
    # ...but named so the GPT knows it can fetch them with compact=false.
    assert "perGame" in compact["diagnosticsOmitted"]
    assert "marketContest" in compact["diagnosticsOmitted"]
    # Small situational-awareness summary survives.
    assert compact["diagnosticsSummary"]["gamesProcessed"] == 1
    assert compact["diagnosticsSummary"]["lineCurveContestedGroups"] == 7
    assert compact["diagnosticsSummary"]["allReturnedRowsResearched"] is True


def test_compact_pool_carries_forward_rate_limit_warning():
    compact = compact_sgm_candidate_pool_response(_full_pool())
    assert any("rate-limited" in note.lower() for note in compact["notes"])


def test_compact_row_surfaces_ledger_gate_fields():
    # The Decision Ledger's robustness/sharp gates must be satisfiable from the
    # lean row without a compact=false round-trip.
    row = {
        "rowId": "r1",
        "player": "Aaron Judge",
        "market": "Total Bases",
        "side": "over",
        "line": 1.5,
        "odds": 1.9,
        "probabilityAssessment": {
            "edgeStatus": "clear_possible_edge",
            "edgeReference": "devigged_fair_probability",
            "dataQuality": "high",
            "impliedProbability": 0.53,
            "fairProbability": 0.5,
            "estimatedProbability": 0.57,
            "adjustedEstimatedProbability": 0.57,
            "edge": 0.07,
            "conservativeEdge": 0.02,  # > 0 -> robust
        },
    }
    compact = _compact_candidate_pool_row(row)
    assert compact["dataQuality"] == "high"
    assert compact["fairProbability"] == 0.5
    assert compact["edge"] == 0.07
    assert compact["conservativeEdge"] == 0.02
    assert compact["edgeRobustToUncertainty"] is True


def test_compact_row_marks_edge_not_robust_when_conservative_edge_negative():
    row = {
        "rowId": "r2",
        "probabilityAssessment": {"edge": 0.04, "conservativeEdge": -0.01},
    }
    compact = _compact_candidate_pool_row(row)
    assert compact["edgeRobustToUncertainty"] is False


def test_compact_row_robustness_none_when_no_positive_edge():
    row = {"rowId": "r3", "probabilityAssessment": {"edge": -0.02, "conservativeEdge": -0.05}}
    assert _compact_candidate_pool_row(row)["edgeRobustToUncertainty"] is None


def test_real_quote_ev_reports_downside_at_the_real_quote():
    # Two legs each carrying a confidence interval -> the slip win-prob band is
    # real, so the EV range at the actual quote is bracketed (downside < point).
    legs = [
        {
            "normalizedMarketKey": "hits",
            "side": "over",
            "odds": 1.7,
            "winProbability": 0.6,
            "confidenceInterval": {"low": 0.45, "high": 0.75},
        },
        {
            "normalizedMarketKey": "total_bases",
            "side": "over",
            "odds": 1.8,
            "winProbability": 0.55,
            "confidenceInterval": {"low": 0.4, "high": 0.7},
        },
    ]
    check = real_quote_ev(legs, quoted_odds=4.0)
    assert check["status"] == "evaluated"
    assert check["winProbabilityRange"] is not None
    assert check["realExpectedValueRange"] is not None
    # Downside (pessimistic win prob priced at the real quote) is below the point EV.
    assert check["realEvDownsidePerUnit"] <= check["realExpectedValue"]


def _build_result() -> dict:
    return {
        "source": "stake_ui_sgm_build_slip",
        "fixtureSlug": "f1",
        "status": "built_for_review",
        "reviewOnly": True,
        "clickedLegs": 2,
        "selectedRows": [
            {
                "rowId": "row-1",
                "player": "Aaron Judge",
                "market": "Total Bases",
                "side": "over",
                "line": 1.5,
                "odds": 1.9,
                "selectionProof": {"big": "x" * 500},
                "probabilityAssessment": {"big": "y" * 500},
            }
        ],
        "clickResults": [
            {"rowId": "row-1", "status": "clicked", "rowText": "z" * 400},
            {"rowId": "row-2", "player": "Ozzie Albies", "status": "not_found", "reason": "row missing"},
        ],
        "addBetResult": {"status": "clicked", "verbosePayload": "w" * 400},
        "transactionPlan": {"huge": list(range(200))},
        "missingSelections": [],
        "warnings": [],
        "safety": {"enteredStakeAmount": False, "clickedPlaceBet": False},
    }


def test_lean_review_slip_collapses_click_audit_but_keeps_decision_fields():
    lean = _lean_review_slip_result(_build_result())

    assert lean["status"] == "built_for_review"
    assert lean["clickedLegs"] == 2
    # selectedRows trimmed to identity (no selectionProof / probabilityAssessment).
    assert lean["selectedRows"][0]["rowId"] == "row-1"
    assert "selectionProof" not in lean["selectedRows"][0]
    # Click audit collapsed to counts + only the failure.
    assert lean["clicks"]["attempted"] == 2
    assert lean["clicks"]["clicked"] == 1
    assert len(lean["clicks"]["failed"]) == 1
    assert lean["clicks"]["failed"][0]["status"] == "not_found"
    # Heavy fields dropped entirely.
    assert "transactionPlan" not in lean
    assert "clickResults" not in lean
    assert lean["addBetResult"] == {"status": "clicked", "reason": None}
    # Safety always asserted.
    assert lean["safety"]["clickedPlaceBet"] is False
    assert "realQuoteCheck" in lean


def test_lean_batch_review_slip_collapses_per_group_audit():
    batch = {
        "source": "stake_ui_sgm_review_slip_batch",
        "status": "built_for_review",
        "reviewOnly": True,
        "fixtureCount": 1,
        "clickedGroups": 1,
        "clickedLegs": 2,
        "groups": [
            {
                "matchup": "Yankees vs Jays",
                "fixtureSlug": "f1",
                "status": "built_for_review",
                "clickedLegs": 2,
                "selectedRows": [{"rowId": "r1", "player": "Judge", "selectionProof": {"x": "y" * 500}}],
                "clickResults": [{"rowId": "r1", "status": "clicked", "rowText": "z" * 400}],
                "transactionPlan": {"huge": list(range(200))},
            }
        ],
        "safety": {"enteredStakeAmount": False, "clickedPlaceBet": False},
    }
    lean = _lean_batch_review_slip_result(batch)
    group = lean["groups"][0]
    assert group["clicks"]["attempted"] == 1
    assert group["clicks"]["clicked"] == 1
    assert "transactionPlan" not in group
    assert "selectionProof" not in group["selectedRows"][0]
    assert lean["clickedGroups"] == 1


def test_lean_ui_state_drops_sidebar_text_dump_but_keeps_flags():
    state = {
        "source": "stake_ui_state",
        "status": "ok",
        "currentFixtureSlug": "f1",
        "sgmVisible": True,
        "slip": {
            "rightPanelFound": True,
            "rightPanelEmpty": False,
            "rightPanelSelectionCount": 3,
            "rightPanelTextSample": "judge over 1.5 total bases",
            "rightPanelText": "x" * 4000,
        },
    }
    lean = _lean_ui_state(state)
    assert lean["sgmVisible"] is True
    assert lean["slip"]["rightPanelSelectionCount"] == 3
    assert lean["slip"]["rightPanelTextSample"] == "judge over 1.5 total bases"
    assert "rightPanelText" not in lean["slip"]
    assert "rightPanelTextOmitted" in lean["slip"]
