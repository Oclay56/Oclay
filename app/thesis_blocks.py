"""Thesis-block slip construction.

A slip is a *portfolio of blocks*, not a flat list of legs:

- A **block** is a 2-16 leg, <=501x same-game cluster whose legs are positively
  correlated and share an edge (tight correlation *inside* a block).
- A **slip** multiplies several blocks from *different* games up to a target
  odds band, keeping the blocks low-correlation with *each other*.

You set the target band; the board sets the shape. The decomposition search
chooses how many blocks and each block's multiplier from what the slate
actually offers that night -- it is never a fixed ``50^x`` / ``10^x`` formula.

This module owns Stages 2-5 of the pipeline (form blocks, rank blocks,
decomposition search to a target band, thesis labeling). It reuses the
single-factor Gaussian copula and predicted-Stake-quote model from
``app.correlation`` / ``app.quote_model`` rather than re-deriving the math, and
it reads the realized per-thesis kill-switch so a losing thesis stops being
surfaced. See ``docs/thesis-block-engine.md``.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any

from .correlation import joint_win_probability, leg_pair_category
from .quote_model import slip_projection

# Hard same-game guardrails (mirrored from sgm_candidate_pool constants).
BLOCK_MIN_LEGS = 2
BLOCK_MAX_LEGS = 16
BLOCK_MAX_ODDS = 501.0

# --- Balance fix #1: per-market-type diminishing cap inside a block ----------
# The Nth leg of one market type pays a growing marginal penalty, and no block
# may exceed this many legs of a single normalized market type.
MARKET_TYPE_HARD_CAP = 4
MARKET_TYPE_PENALTY_STEP = 0.04  # EV units shaved per prior leg of the same type
FAMILY_PENALTY_STEP = 0.015  # softer shave for same broad family

# --- Balance fix #2: first-X / lottery risk class ----------------------------
# Lottery markets the counting-stat model estimates least reliably, plus any
# "first" / sequence prop detected by name. Their win probability is shrunk
# toward a coin-flip and at most one may appear per block.
LOTTERY_MARKETS = {"home_runs", "stolen_bases"}
SEQUENCE_NAME_HINTS = ("first", "1st", "anytime", "to record", "to hit", "to score")
SEQUENCE_SHRINK = 0.82  # multiplicative haircut on the win probability used
SEQUENCE_PER_BLOCK_CAP = 1

# --- Balance fix #3: cross-game same-direction concentration ------------------
# Blocks leaning the same way on the same family share a latent common factor.
# Concentration drives an effective cross-block correlation; the copula turns
# that into a "fragility" lift we refuse to credit and instead penalize.
CROSS_BLOCK_MAX_RHO = 0.18
FRAGILITY_PENALTY_WEIGHT = 1.5

# Broad market families for the diversity penalty and tilt bucketing.
_BATTER_VOLUME = {"hits", "total_bases", "singles", "runs", "rbi", "hits_runs_rbis", "home_runs"}
_BATTER_DISCIPLINE = {"batter_walks", "batter_strikeouts"}
_PITCHER = {"strikeouts", "pitcher_strikeouts", "hits_allowed", "earned_runs", "walks_allowed", "outs_recorded"}

# Decomposition search width.
_BEAM_WIDTH = 256
_EVMAX_ODDS_CEILING = 250_000.0


# ----------------------------------------------------------------------
# Leg-level helpers
# ----------------------------------------------------------------------
def _float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _market_key(leg: dict[str, Any]) -> str:
    market = leg.get("normalizedMarketKey")
    if market:
        return str(market).replace("-", "_")
    market = leg.get("market")
    if isinstance(market, dict):
        market = market.get("key")
    return str(market or "").strip().lower().replace("-", "_").replace(" ", "_")


def _market_family(market_key: str) -> str:
    if market_key in _BATTER_VOLUME:
        return "batter_volume"
    if market_key in _BATTER_DISCIPLINE:
        return "batter_discipline"
    if market_key in _PITCHER:
        return "pitcher_suppression"
    return market_key or "other"


def _player_key(leg: dict[str, Any]) -> str:
    player = leg.get("player")
    if isinstance(player, dict):
        player = player.get("key") or player.get("name")
    return str(player or "").strip().lower()


def _side(leg: dict[str, Any]) -> str:
    return str(leg.get("side") or "").lower()


def _raw_win_probability(leg: dict[str, Any]) -> float | None:
    for key in ("winProbability", "estimatedProbability", "fairProbability"):
        value = _float(leg.get(key))
        if value is not None:
            return value
    probability = leg.get("probabilityAssessment")
    if isinstance(probability, dict):
        return _float(
            probability.get("estimatedProbability")
            or probability.get("adjustedEstimatedProbability")
        )
    return None


def is_sequence_leg(leg: dict[str, Any]) -> bool:
    """A first-X / lottery leg whose edge estimate is the least trustworthy."""
    if _market_key(leg) in LOTTERY_MARKETS:
        return True
    label = str(
        (leg.get("market") if not isinstance(leg.get("market"), dict) else (leg.get("market") or {}).get("name"))
        or leg.get("marketLabel")
        or ""
    ).lower()
    return any(hint in label for hint in SEQUENCE_NAME_HINTS)


def _block_leg(leg: dict[str, Any]) -> dict[str, Any]:
    """A copy carrying the *effective* win probability used for block math.

    Sequence/lottery legs (fix #2) are shrunk toward a coin flip so the copula
    never over-credits a prop the model cannot really price. The original
    candidate dict is never mutated.
    """
    raw = _raw_win_probability(leg)
    copy = dict(leg)
    if raw is not None:
        effective = 0.5 + (raw - 0.5) * SEQUENCE_SHRINK if is_sequence_leg(leg) else raw
        copy["winProbability"] = round(max(0.01, min(0.99, effective)), 6)
    return copy


def _priced(leg: dict[str, Any]) -> bool:
    return _raw_win_probability(leg) is not None and (_float(leg.get("odds")) or 0.0) > 1.0


# ----------------------------------------------------------------------
# Stage 2: form a block from one game's candidate legs
# ----------------------------------------------------------------------
def build_block(
    legs: list[dict[str, Any]],
    *,
    min_legs: int = BLOCK_MIN_LEGS,
    max_legs: int = BLOCK_MAX_LEGS,
    max_odds: float = BLOCK_MAX_ODDS,
    market_type_cap: int = MARKET_TYPE_HARD_CAP,
) -> dict[str, Any] | None:
    """Greedily assemble the best correlated, diversified block for one game.

    At each step it adds the leg with the highest *diversity-adjusted* marginal
    expected value (fix #1), under the 2/16/501x guardrails, one leg per player,
    the per-market-type hard cap, and the one-sequence-leg cap (fix #2). It
    stops when EV stops improving past the minimum. Returns ``None`` if fewer
    than ``min_legs`` priced legs are available.
    """
    eligible = [_block_leg(leg) for leg in legs if _priced(leg)]
    # Keep only the highest standalone-EV leg per player so the builder never
    # wastes a slot on two legs from one player it cannot combine.
    best_by_player: dict[str, dict[str, Any]] = {}
    for leg in eligible:
        key = _player_key(leg)
        if key and (key not in best_by_player or _standalone_ev(leg) > _standalone_ev(best_by_player[key])):
            best_by_player[key] = leg
        elif not key:
            best_by_player[id(leg)] = leg  # team markets without a player
    pool = list(best_by_player.values())
    if len(pool) < min_legs:
        return None

    selected: list[dict[str, Any]] = []
    used_players: set[str] = set()
    type_counts: Counter[str] = Counter()
    family_counts: Counter[str] = Counter()
    sequence_count = 0
    best_proj: dict[str, Any] | None = None
    ev_curve: list[dict[str, Any]] = []

    while len(selected) < max_legs:
        chosen: tuple[dict[str, Any], dict[str, Any], float] | None = None
        chosen_adj = None
        selected_ids = {id(leg) for leg in selected}
        for leg in pool:
            if id(leg) in selected_ids:
                continue
            player = _player_key(leg)
            if player and player in used_players:
                continue
            mtype = _market_key(leg)
            if type_counts[mtype] >= market_type_cap:
                continue
            if is_sequence_leg(leg) and sequence_count >= SEQUENCE_PER_BLOCK_CAP:
                continue
            trial = selected + [leg]
            projection = slip_projection(trial)
            product = projection.get("rawProductOdds") or 0.0
            if product > max_odds:
                continue
            ev = projection.get("expectedValue")
            if ev is None:
                continue
            # Diversity-adjusted marginal value (fix #1): each prior leg of the
            # same type/family makes this one worth progressively less.
            penalty = (
                MARKET_TYPE_PENALTY_STEP * type_counts[mtype]
                + FAMILY_PENALTY_STEP * family_counts[_market_family(mtype)]
            )
            adjusted = ev - penalty
            if chosen_adj is None or adjusted > chosen_adj:
                chosen_adj = adjusted
                chosen = (leg, projection, ev)
        if chosen is None:
            break
        leg, projection, ev = chosen
        prev_ev = best_proj.get("expectedValue") if best_proj else None
        if len(selected) >= min_legs and prev_ev is not None and ev <= prev_ev:
            break  # EV peaked; stop growing
        selected.append(leg)
        if (player := _player_key(leg)):
            used_players.add(player)
        mtype = _market_key(leg)
        type_counts[mtype] += 1
        family_counts[_market_family(mtype)] += 1
        if is_sequence_leg(leg):
            sequence_count += 1
        best_proj = projection
        ev_curve.append(
            {
                "legCount": len(selected),
                "addedPlayer": leg.get("player"),
                "addedMarket": mtype,
                "expectedValue": ev,
                "winProbability": projection.get("estimatedWinProbability"),
                "productOdds": projection.get("rawProductOdds"),
            }
        )

    if len(selected) < min_legs or best_proj is None:
        return None
    return _finalize_block(selected, best_proj, type_counts, ev_curve)


def _finalize_block(
    legs: list[dict[str, Any]],
    projection: dict[str, Any],
    type_counts: Counter[str],
    ev_curve: list[dict[str, Any]],
) -> dict[str, Any]:
    payout = _float(projection.get("predictedQuote")) or _float(projection.get("rawProductOdds")) or 0.0
    win = _float(projection.get("estimatedWinProbability"))
    label = label_block(legs)
    fixture = str(legs[0].get("fixtureSlug") or legs[0].get("matchup") or "unknown")
    return {
        "fixtureSlug": fixture,
        "matchup": legs[0].get("matchup"),
        "legCount": len(legs),
        "legs": legs,
        "rowIds": [leg.get("rowId") for leg in legs],
        "winProbability": round(win, 4) if win is not None else None,
        "payoutOdds": round(payout, 4) if payout else None,
        "rawProductOdds": projection.get("rawProductOdds"),
        "expectedValue": projection.get("expectedValue"),
        "correlationLift": projection.get("correlationLift"),
        "marketMix": dict(type_counts),
        "sequenceLegs": sum(1 for leg in legs if is_sequence_leg(leg)),
        "tilt": _block_tilt(legs),
        "thesis": label["thesis"],
        "thesisTag": label["thesisTag"],
        "dominantCategory": label["dominantCategory"],
        "evCurve": ev_curve,
        "withinGuardrails": (
            BLOCK_MIN_LEGS <= len(legs) <= BLOCK_MAX_LEGS
            and (payout or 0.0) <= BLOCK_MAX_ODDS
        ),
    }


def _standalone_ev(leg: dict[str, Any]) -> float:
    win = _raw_win_probability(leg) or 0.0
    odds = _float(leg.get("odds")) or 1.0
    return win * (odds - 1.0) - (1.0 - win)


# ----------------------------------------------------------------------
# Stage 5: thesis labeling (descriptive only)
# ----------------------------------------------------------------------
def _block_tilt(legs: list[dict[str, Any]]) -> dict[str, Any]:
    """The block's dominant (family, side) lean -- used for cross-block tax."""
    counter: Counter[tuple[str, str]] = Counter()
    for leg in legs:
        counter[(_market_family(_market_key(leg)), _side(leg))] += 1
    if not counter:
        return {"family": "other", "side": "", "share": 0.0}
    (family, side), count = counter.most_common(1)[0]
    return {"family": family, "side": side, "share": round(count / len(legs), 3)}


def label_block(legs: list[dict[str, Any]]) -> dict[str, Any]:
    """Attach a human thesis from the block's dominant correlation pattern.

    This is output only -- it never drives selection. The label is derived from
    the most common pairwise correlation category across the block's legs.
    """
    categories: Counter[str] = Counter()
    for i in range(len(legs)):
        for j in range(i + 1, len(legs)):
            categories[leg_pair_category(legs[i], legs[j])] += 1
    dominant = categories.most_common(1)[0][0] if categories else "same_game_default_same_dir"
    tilt = _block_tilt(legs)
    over = tilt["side"] == "over"

    if dominant.startswith("pitcher_vs_hitter_aligned"):
        thesis, tag = "Ace suppresses the opposing lineup", "ace_suppression"
    elif dominant.startswith("same_team_offense"):
        thesis, tag = (
            ("Offense erupts together", "offense_explosion")
            if over
            else ("Offense gets shut down together", "offense_shutdown")
        )
    elif dominant.startswith("same_player_same_family"):
        thesis, tag = "Single-player game script", "player_game_script"
    elif dominant.startswith("same_player_cross_family"):
        thesis, tag = "Player multi-stat script", "player_multistat"
    elif dominant.startswith("pitcher_vs_hitter_opposed"):
        thesis, tag = "Mixed pitcher / hitter outcomes", "mixed_pitcher_hitter"
    else:
        thesis, tag = "Mixed same-game script", "mixed_game_script"
    return {"thesis": thesis, "thesisTag": tag, "dominantCategory": dominant}


# ----------------------------------------------------------------------
# Stage 3: rank / filter blocks (reads the realized per-thesis kill-switch)
# ----------------------------------------------------------------------
def _get_thesis_policies() -> dict[str, dict[str, Any]]:
    try:
        from .pick_ledger import PickLedger

        return PickLedger().load_thesis_policies()
    except Exception:
        return {}


def rank_blocks(
    blocks: list[dict[str, Any]],
    *,
    thesis_policies: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Drop blocks on a killed thesis, downweight marginal ones, sort by merit.

    The kill-switch is the same realized-ROI mechanism that gates markets, here
    applied to thesis tags: a thesis whose graded ROI went negative is excluded
    or downweighted so it stops being surfaced.
    """
    policies = thesis_policies if thesis_policies is not None else _get_thesis_policies()
    ranked: list[dict[str, Any]] = []
    for block in blocks:
        policy = policies.get(str(block.get("thesisTag") or "")) or {}
        status = str(policy.get("status") or "")
        block = dict(block)
        block["thesisPolicy"] = {"status": status or "unrated", "realizedRoi": policy.get("realizedRoi")}
        if status == "exclude":
            block["excludedReason"] = "thesis_killed_negative_realized_roi"
            continue
        merit = _float(block.get("expectedValue")) or 0.0
        if status == "downweight":
            merit -= 0.05
        block["blockMerit"] = round(merit, 4)
        ranked.append(block)
    ranked.sort(
        key=lambda b: (b.get("blockMerit") or 0.0, b.get("winProbability") or 0.0),
        reverse=True,
    )
    return ranked


def build_blocks_by_game(ranked_candidates: list[dict[str, Any]], **kwargs: Any) -> list[dict[str, Any]]:
    """One block per game from the slate's ranked candidate legs."""
    by_game: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in ranked_candidates:
        by_game[str(row.get("fixtureSlug") or "unknown")].append(row)
    blocks: list[dict[str, Any]] = []
    for legs in by_game.values():
        block = build_block(legs, **kwargs)
        if block is not None:
            blocks.append(block)
    return blocks


# ----------------------------------------------------------------------
# Stage 4: decomposition search to a target odds band
# ----------------------------------------------------------------------
def _cross_block_rho(blocks: list[dict[str, Any]]) -> float:
    """Effective cross-block correlation from same-direction concentration.

    Rises as a majority of blocks lean the same (family, side): zero when no
    direction holds more than half the slip, maximal when every block leans the
    same way. This is what makes a concentrated slip pay a fragility penalty.
    """
    if len(blocks) < 2:
        return 0.0
    tilts: Counter[tuple[str, str]] = Counter()
    for block in blocks:
        tilt = block.get("tilt") or {}
        tilts[(str(tilt.get("family")), str(tilt.get("side")))] += 1
    dominant_share = tilts.most_common(1)[0][1] / len(blocks)
    excess = max(0.0, (dominant_share - 0.5) / 0.5)  # 0 at <=50%, 1 at 100%
    return round(CROSS_BLOCK_MAX_RHO * excess, 4)


def _blueprint_metrics(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """Joint probability, odds, and risk-adjusted EV for a set of blocks.

    The joint win probability is reported at *independence* (we do not credit
    the favorable copula lift from a shared common factor, because that lift is
    fragile). Fix #3: that same fragility -- measured by running the blocks back
    through the copula at the concentration-driven rho -- becomes a penalty, so
    a concentrated slip is ranked below an equally-priced diversified one.
    """
    probs = [b["winProbability"] for b in blocks if b.get("winProbability") is not None]
    odds = [b["payoutOdds"] for b in blocks if b.get("payoutOdds")]
    if not probs or len(odds) != len(blocks):
        return {"valid": False}
    product_odds = math.prod(odds)
    independence = math.prod(probs)
    rho = _cross_block_rho(blocks)
    correlated = joint_win_probability(probs, rho)
    fragility = max(0.0, correlated - independence)
    ev = independence * (product_odds - 1.0) - (1.0 - independence)
    risk_adjusted = ev - FRAGILITY_PENALTY_WEIGHT * fragility * product_odds
    tilts = Counter((str((b.get('tilt') or {}).get('family')), str((b.get('tilt') or {}).get('side'))) for b in blocks)
    concentration = round(sum((c / len(blocks)) ** 2 for c in tilts.values()), 4)
    return {
        "valid": True,
        "blockCount": len(blocks),
        "productOdds": round(product_odds, 2),
        "jointWinProbability": round(independence, 6),
        "crossBlockRho": rho,
        "sharedFactorFragility": round(fragility, 6),
        "concentration": concentration,
        "expectedValue": round(ev, 4),
        "riskAdjustedValue": round(risk_adjusted, 4),
    }


def assemble_to_target(
    blocks: list[dict[str, Any]],
    *,
    target_min: float,
    target_max: float,
    max_blocks: int = 8,
    beam_width: int = _BEAM_WIDTH,
    top_n: int = 3,
) -> list[dict[str, Any]]:
    """Find block combinations whose odds land in [target_min, target_max].

    One block per game. Beam search over combinations, pruning any partial whose
    odds already exceed ``target_max`` (odds only grow as blocks are added).
    Returns up to ``top_n`` blueprints ranked by risk-adjusted value -- the
    board, not a fixed power formula, decides the block count and multipliers.
    """
    usable = [b for b in blocks if b.get("payoutOdds") and b.get("winProbability") is not None]
    usable.sort(key=lambda b: b.get("payoutOdds") or 0.0, reverse=True)
    if not usable or target_min <= 0:
        return []

    # State: (fixtures_used, blocks, log_odds). Seed with the empty set.
    states: list[tuple[frozenset[str], tuple[int, ...], float]] = [(frozenset(), (), 0.0)]
    log_max = math.log(target_max)
    completed: list[list[dict[str, Any]]] = []

    for idx, block in enumerate(usable):
        fixture = str(block.get("fixtureSlug"))
        leg_log = math.log(block["payoutOdds"])
        new_states: list[tuple[frozenset[str], tuple[int, ...], float]] = []
        for fixtures, chosen, log_odds in states:
            if fixture in fixtures or len(chosen) >= max_blocks:
                continue
            combined = log_odds + leg_log
            if combined > log_max + 1e-9:
                continue
            new_states.append((fixtures | {fixture}, chosen + (idx,), combined))
        states.extend(new_states)
        # Record completed combinations that now sit inside the band.
        for fixtures, chosen, log_odds in new_states:
            if log_odds >= math.log(target_min) - 1e-9:
                completed.append([usable[i] for i in chosen])
        # Beam: keep the most promising partial states (closest to the band,
        # then highest joint probability) to bound the search.
        states.sort(key=lambda s: (s[2], len(s[1])), reverse=True)
        states = states[:beam_width]

    scored: list[dict[str, Any]] = []
    seen: set[tuple[int, ...]] = set()
    for combo in completed:
        signature = tuple(sorted(str(b.get("fixtureSlug")) for b in combo))
        if signature in seen:
            continue
        seen.add(signature)
        metrics = _blueprint_metrics(combo)
        if metrics.get("valid"):
            scored.append(_make_blueprint(combo, metrics, target_min, target_max))
    scored.sort(key=lambda bp: bp["riskAdjustedValue"], reverse=True)
    return scored[:top_n]


def _make_blueprint(
    blocks: list[dict[str, Any]],
    metrics: dict[str, Any],
    target_min: float,
    target_max: float,
) -> dict[str, Any]:
    return {
        "structure": f"{len(blocks)}-block",
        "targetBand": {"min": target_min, "max": target_max},
        "blockCount": metrics["blockCount"],
        "productOdds": metrics["productOdds"],
        "jointWinProbability": metrics["jointWinProbability"],
        "expectedValue": metrics["expectedValue"],
        "riskAdjustedValue": metrics["riskAdjustedValue"],
        "concentration": metrics["concentration"],
        "crossBlockRho": metrics["crossBlockRho"],
        "sharedFactorFragility": metrics["sharedFactorFragility"],
        "thesisTags": [b.get("thesisTag") for b in blocks],
        "marginalContribution": _marginal_contributions(blocks),
        "blocks": [
            {
                "fixtureSlug": b.get("fixtureSlug"),
                "matchup": b.get("matchup"),
                "thesis": b.get("thesis"),
                "thesisTag": b.get("thesisTag"),
                "legCount": b.get("legCount"),
                "payoutOdds": b.get("payoutOdds"),
                "winProbability": b.get("winProbability"),
                "rowIds": b.get("rowIds"),
                "tilt": b.get("tilt"),
            }
            for b in blocks
        ],
    }


def _marginal_contributions(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fix #4: what each block costs the slip -- joint prob and odds delta.

    Makes the compounding visible: adding the Nth block multiplies the payout
    but drops the slip's win probability by a real, quoted amount.
    """
    probs = [b["winProbability"] for b in blocks]
    odds = [b["payoutOdds"] for b in blocks]
    full_prob = math.prod(probs)
    full_odds = math.prod(odds)
    out: list[dict[str, Any]] = []
    for i, block in enumerate(blocks):
        without_prob = math.prod(p for j, p in enumerate(probs) if j != i)
        out.append(
            {
                "fixtureSlug": block.get("fixtureSlug"),
                "thesisTag": block.get("thesisTag"),
                "winProbabilityWithout": round(without_prob, 6),
                "winProbabilityWith": round(full_prob, 6),
                "winProbabilityCost": round(full_prob - without_prob, 6),
                "oddsMultiplier": round(block["payoutOdds"], 4),
                "slipOdds": round(full_odds, 2),
            }
        )
    return out


def assemble_ev_max(blocks: list[dict[str, Any]], *, max_blocks: int = 8) -> dict[str, Any] | None:
    """Default blueprint: add blocks (highest merit first) while EV improves.

    Used when no target band is requested -- the honest "best slip the board
    offers" rather than a forced multiplier.
    """
    usable = [b for b in blocks if b.get("payoutOdds") and b.get("winProbability") is not None]
    usable.sort(key=lambda b: (b.get("blockMerit") if b.get("blockMerit") is not None else (b.get("expectedValue") or 0.0)), reverse=True)
    chosen: list[dict[str, Any]] = []
    used: set[str] = set()
    best_value = None
    for block in usable:
        fixture = str(block.get("fixtureSlug"))
        if fixture in used or len(chosen) >= max_blocks:
            continue
        trial = chosen + [block]
        metrics = _blueprint_metrics(trial)
        if not metrics.get("valid") or metrics["productOdds"] > _EVMAX_ODDS_CEILING:
            continue
        value = metrics["riskAdjustedValue"]
        if len(chosen) >= 1 and best_value is not None and value <= best_value:
            continue
        chosen = trial
        used.add(fixture)
        best_value = value
    if len(chosen) < 1:
        return None
    metrics = _blueprint_metrics(chosen)
    if not metrics.get("valid"):
        return None
    return _make_blueprint(chosen, metrics, target_min=metrics["productOdds"], target_max=metrics["productOdds"])


# ----------------------------------------------------------------------
# Public entrypoint: full board -> blocks + blueprints
# ----------------------------------------------------------------------
def build_slip_blueprints(
    ranked_candidates: list[dict[str, Any]],
    *,
    target_odds_min: float | None = None,
    target_odds_max: float | None = None,
    max_blocks: int = 8,
    block_kwargs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Stage 2-5 in one call: build per-game blocks and target-band blueprints.

    This is what the candidate-pool endpoint surfaces. The Custom GPT still owns
    the final pick; these are board-driven blueprints, not auto-placed bets.
    """
    blocks = build_blocks_by_game(ranked_candidates, **(block_kwargs or {}))
    ranked = rank_blocks(blocks)

    band_blueprints: list[dict[str, Any]] = []
    band_note = None
    if target_odds_min and target_odds_max and target_odds_max >= target_odds_min:
        band_blueprints = assemble_to_target(
            ranked,
            target_min=float(target_odds_min),
            target_max=float(target_odds_max),
            max_blocks=max_blocks,
        )
        if not band_blueprints:
            reach = math.prod(b["payoutOdds"] for b in ranked[:max_blocks] if b.get("payoutOdds")) if ranked else 0.0
            band_note = (
                f"No combination of tonight's blocks lands in {target_odds_min:g}-{target_odds_max:g}x; "
                f"the board tops out around {reach:,.0f}x with {min(len(ranked), max_blocks)} blocks. "
                "Lower the target or accept the EV-max blueprint."
            )

    ev_max = assemble_ev_max(ranked, max_blocks=max_blocks)

    return {
        "engine": "thesis_block_slip_engine",
        "decisionOwner": "custom_gpt",
        "guardrails": {
            "minLegsPerBlock": BLOCK_MIN_LEGS,
            "maxLegsPerBlock": BLOCK_MAX_LEGS,
            "maxOddsPerBlock": BLOCK_MAX_ODDS,
        },
        "blockCount": len(ranked),
        "blocks": ranked,
        "targetBand": (
            {"min": target_odds_min, "max": target_odds_max}
            if target_odds_min and target_odds_max
            else None
        ),
        "bandBlueprints": band_blueprints,
        "bandNote": band_note,
        "evMaxBlueprint": ev_max,
        "balanceControls": {
            "marketTypeHardCap": MARKET_TYPE_HARD_CAP,
            "sequencePerBlockCap": SEQUENCE_PER_BLOCK_CAP,
            "sequenceShrink": SEQUENCE_SHRINK,
            "crossBlockMaxRho": CROSS_BLOCK_MAX_RHO,
        },
        "note": (
            "Blocks are board-driven same-game clusters under the 2/16/501x caps; "
            "the decomposition search chooses block count and multipliers from the "
            "actual slate, not a fixed power formula."
        ),
    }
