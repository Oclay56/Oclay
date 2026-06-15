"""Adaptive band menu for the local decision dashboard (Phase 1, read-only).

Turns the engine's dominance **frontier** (from ``build_slip_blueprints``) into a
clean, leg-resolved, exposure-annotated menu of payout bands -- the data the TUI
renders. Each band is the sharpest reachable slip at its payout magnitude; the
menu is *adaptive* (it only contains what the board actually reaches tonight, with
the top rung flagged ``max reachable``).

Pure function: blueprints + ranked candidates in, band menu out. No Stake contact,
no building, no AI. ``assemble_bands`` is fully unit-testable in isolation.
"""

from __future__ import annotations

from collections import Counter
from typing import Any


def _pa_get(row: dict[str, Any], key: str) -> Any:
    """Read a probability field from either the full row's probabilityAssessment
    or a compact row's top level."""
    pa = row.get("probabilityAssessment")
    if isinstance(pa, dict) and key in pa and pa[key] is not None:
        return pa[key]
    return row.get(key)


def _candidate_index(ranked_candidates: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for row in ranked_candidates or []:
        if not isinstance(row, dict):
            continue
        row_id = row.get("rowId")
        if row_id is not None:
            index[str(row_id)] = row
    return index


def _magnitude_label(odds: Any, *, is_max: bool) -> str | None:
    if not isinstance(odds, (int, float)) or odds <= 0:
        return None
    label = f"~{round(odds):,}x"
    return f"{label} (max reachable)" if is_max else label


def _leg_view(row: dict[str, Any]) -> dict[str, Any]:
    """The decision-relevant view of a single leg, with a short 'why'."""
    sharp = row.get("sharpLineSignal") or {}
    stale = row.get("staleLineSignal") or {}
    edge_status = _pa_get(row, "edgeStatus")
    why: list[str] = []
    if edge_status in {"clear_possible_edge", "thin_edge"}:
        why.append(edge_status)
    if sharp.get("matched") and sharp.get("direction") == "beats_sharp_consensus":
        why.append("beats_sharp")
    if stale.get("isStale"):
        why.append("stale_line")
    return {
        "rowId": row.get("rowId"),
        "player": row.get("player"),
        "team": row.get("team"),
        "market": row.get("market"),
        "side": row.get("side"),
        "line": row.get("line"),
        "odds": row.get("odds"),
        "edge": _pa_get(row, "edge"),
        "edgeStatus": edge_status,
        "dataQuality": _pa_get(row, "dataQuality"),
        "edgeRobustToUncertainty": _pa_get(row, "edgeRobustToUncertainty"),
        "why": why,
    }


def _exposure(legs: list[dict[str, Any]]) -> dict[str, Any]:
    """How a band's legs split across market / player / game -- a *display*
    readout so a hits-heavy or one-player-heavy slip is visible at a glance.
    Informational only (never a gate or a dial; see design doc 4)."""
    total = len(legs)
    markets = Counter(str(leg.get("market")) for leg in legs if leg.get("market"))
    players = Counter(str(leg.get("player")) for leg in legs if leg.get("player"))
    games = Counter(str(leg.get("fixtureSlug") or leg.get("matchup")) for leg in legs)
    top_market, top_market_n = markets.most_common(1)[0] if markets else (None, 0)
    return {
        "legCount": total,
        "byMarket": dict(markets),
        "distinctPlayers": len(players),
        "distinctGames": len([g for g in games if g and g != "None"]),
        "topMarket": top_market,
        "topMarketShare": round(top_market_n / total, 2) if total else None,
    }


def _band_from_rung(
    rung: dict[str, Any],
    candidate_index: dict[str, dict[str, Any]],
    *,
    is_max: bool,
) -> dict[str, Any]:
    legs_by_game: list[dict[str, Any]] = []
    all_legs: list[dict[str, Any]] = []
    unresolved = 0
    for block in rung.get("blocks") or []:
        game_legs: list[dict[str, Any]] = []
        for row_id in block.get("rowIds") or []:
            row = candidate_index.get(str(row_id))
            if row is None:
                unresolved += 1
                continue
            leg = _leg_view(row)
            # carry the game key for exposure grouping
            leg["fixtureSlug"] = row.get("fixtureSlug") or block.get("fixtureSlug")
            leg["matchup"] = row.get("matchup") or block.get("matchup")
            game_legs.append(leg)
            all_legs.append(leg)
        legs_by_game.append(
            {
                "fixtureSlug": block.get("fixtureSlug"),
                "matchup": block.get("matchup"),
                "thesis": block.get("thesis"),
                "thesisTag": block.get("thesisTag"),
                "blockOdds": block.get("payoutOdds"),
                "blockWinProbability": block.get("winProbability"),
                "legs": game_legs,
            }
        )

    payout = rung.get("productOdds") or rung.get("payoutOdds")
    # Execution-ready gating: a band is buildable only if every leg resolved to a
    # real UI rowId from the candidate pool (design doc 12). Otherwise it's shown
    # but flagged, never silently built.
    buildable = bool(all_legs) and unresolved == 0
    return {
        "tier": rung.get("tier"),
        "tierRank": rung.get("tierRank"),
        "label": _magnitude_label(payout, is_max=is_max),
        "payoutOdds": payout,
        "winProbability": rung.get("jointWinProbability") or rung.get("winProbability"),
        "expectedValue": rung.get("expectedValue"),
        "riskAdjustedValue": rung.get("riskAdjustedValue"),
        "structure": rung.get("structure"),
        "thesisTags": [tag for tag in (rung.get("thesisTags") or []) if tag],
        "concentration": rung.get("concentration"),
        "correlationEdge": rung.get("correlationEdge"),
        "legsByGame": legs_by_game,
        "exposure": _exposure(all_legs),
        "buildable": buildable,
        "unresolvedLegs": unresolved,
    }


def assemble_bands(
    blueprints: dict[str, Any] | None,
    ranked_candidates: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Build the adaptive band menu from the candidate pool's blueprints.

    ``blueprints`` is the ``slipBlueprints`` dict (must carry ``frontier``);
    ``ranked_candidates`` resolves each block's rowIds into real legs.
    """
    blueprints = blueprints or {}
    frontier = blueprints.get("frontier") or []
    candidate_index = _candidate_index(ranked_candidates)

    bands: list[dict[str, Any]] = []
    last = len(frontier) - 1
    for i, rung in enumerate(frontier):
        if isinstance(rung, dict):
            bands.append(_band_from_rung(rung, candidate_index, is_max=(i == last)))

    payouts = [b["payoutOdds"] for b in bands if isinstance(b.get("payoutOdds"), (int, float))]
    games_used = sorted(
        {
            g.get("fixtureSlug")
            for b in bands
            for g in b["legsByGame"]
            if g.get("fixtureSlug")
        }
    )
    return {
        "source": "oclay_band_menu",
        "bandCount": len(bands),
        "maxReachableOdds": max(payouts) if payouts else None,
        "minBandOdds": min(payouts) if payouts else None,
        "gamesUsed": games_used,
        "frontierBand": blueprints.get("frontierBand"),
        "frontierNote": blueprints.get("frontierNote"),
        "bands": bands,
        "note": (
            "Adaptive band menu: each band is the sharpest reachable slip at its "
            "payout (the dominance frontier). Read-only -- nothing is built. A band "
            "with buildable=false has legs that did not resolve to live UI rows."
        ),
    }
