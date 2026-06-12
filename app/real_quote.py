"""Final EV check against Stake's real same-game-parlay quote.

Everything upstream models the slip from a product of leg odds and warns it
is not a final Stake quote, because Stake's SGM engine reprices correlated
legs through betFactor. But when the helper builds the review slip, the real
combined odds are sitting in the live sidebar. This module reads that quote
out of the captured sidebar text and computes the only EV that ultimately
matters: model win probability x the actual payout Stake is offering.

If the real quote diverges from the product of leg odds, that gap is the
correlation repricing made explicit.
"""

from __future__ import annotations

import re
from typing import Any

from .correlation import slip_probability_and_ev


_TOTAL_ODDS_PATTERNS = (
    re.compile(r"total\s*odds[^0-9]{0,12}([0-9]+(?:[.,][0-9]+)?)", re.IGNORECASE),
    re.compile(r"(?:est(?:\.|imated)?\s*)?(?:multiplier|payout multiplier)[^0-9]{0,12}([0-9]+(?:[.,][0-9]+)?)", re.IGNORECASE),
    re.compile(r"([0-9]+(?:[.,][0-9]+)?)\s*[xX]\b"),
)


def parse_sidebar_quote(text: Any) -> dict[str, Any]:
    """Extract the combined SGM decimal odds from captured sidebar text."""
    raw = str(text or "")
    if not raw.strip():
        return {"quotedOdds": None, "source": "no_sidebar_text"}
    best: float | None = None
    matched_by: str | None = None
    for pattern in _TOTAL_ODDS_PATTERNS:
        for match in pattern.finditer(raw):
            value = _to_float(match.group(1))
            # SGM combined odds are > 1; ignore stray small numbers like leg
            # counts, and prefer the largest plausible multiplier on the slip.
            if value is None or value <= 1.0 or value > 100000:
                continue
            if best is None or value > best:
                best = value
                matched_by = pattern.pattern
    if best is None:
        return {"quotedOdds": None, "source": "no_quote_found_in_text"}
    return {"quotedOdds": round(best, 4), "source": "parsed_sidebar_text", "matchedPattern": matched_by}


def real_quote_ev(
    selected_legs: list[dict[str, Any]],
    quoted_odds: float | None,
) -> dict[str, Any]:
    """Model win probability vs the actual Stake payout."""
    projection = slip_probability_and_ev(selected_legs)
    win = projection.get("estimatedWinProbability")
    product_odds = projection.get("rawProductOdds")
    result: dict[str, Any] = {
        "modeledWinProbability": win,
        "productOfLegOdds": product_odds,
        "quotedOdds": quoted_odds,
        "fullyPriced": projection.get("fullyPriced"),
    }
    if quoted_odds is None or quoted_odds <= 1.0:
        result["status"] = "quote_unavailable"
        return result
    if win is None:
        result["status"] = "legs_unpriced"
        return result

    real_ev = round(win * (quoted_odds - 1.0) - (1.0 - win), 4)
    product_ev = (
        round(win * (product_odds - 1.0) - (1.0 - win), 4) if product_odds else None
    )
    repricing_gap = (
        round(quoted_odds - product_odds, 4) if product_odds else None
    )
    result.update(
        {
            "status": "evaluated",
            "realExpectedValue": real_ev,
            "productExpectedValue": product_ev,
            "correlationRepricingGap": repricing_gap,
            "verdict": _verdict(real_ev),
            "note": (
                "realExpectedValue uses the actual Stake combined odds; a negative "
                "correlationRepricingGap means Stake priced the SGM below the naive "
                "product of legs."
            ),
        }
    )
    return result


def real_quote_check_from_result(result: dict[str, Any]) -> dict[str, Any]:
    """Build the real-quote EV check from a review-slip result payload.

    When a real combined quote is parsed, log it as a training observation so
    the quote predictor tightens toward Stake's actual repricing over time.
    """
    selected = [row for row in (result.get("selectedRows") or []) if isinstance(row, dict)]
    legs = [_leg_from_selected_row(row) for row in selected]
    sidebar_text = _sidebar_text_from_result(result)
    quote = parse_sidebar_quote(sidebar_text)
    quoted_odds = quote.get("quotedOdds")
    check = real_quote_ev(legs, quoted_odds)
    check["quoteSource"] = quote.get("source")
    _log_quote_observation(legs, quoted_odds)
    return check


def _log_quote_observation(legs: list[dict[str, Any]], quoted_odds: Any) -> None:
    if not quoted_odds:
        return
    try:
        from .pick_ledger import PickLedger
        from .quote_model import invalidate_quote_model_cache, quote_observation

        observation = quote_observation(legs, float(quoted_odds))
        if observation is not None:
            PickLedger().record_quote_observations([observation])
            invalidate_quote_model_cache()
    except Exception:
        pass


def _leg_from_selected_row(row: dict[str, Any]) -> dict[str, Any]:
    probability = row.get("probabilityAssessment") or {}
    return {
        "fixtureSlug": row.get("fixtureSlug"),
        "player": row.get("player"),
        "team": row.get("team"),
        "normalizedMarketKey": row.get("market"),
        "side": row.get("side"),
        "odds": row.get("odds"),
        "winProbability": probability.get("estimatedProbability"),
    }


def _sidebar_text_from_result(result: dict[str, Any]) -> str:
    add_bet = result.get("addBetResult") or {}
    for state_key in ("postClick", "beforeClick"):
        state = add_bet.get(state_key) or {}
        text = state.get("rightPanelText") or state.get("rightPanelTextSample")
        if text:
            return str(text)
    return ""


def _verdict(real_ev: float) -> str:
    if real_ev >= 0.05:
        return "positive_ev_at_real_quote"
    if real_ev >= 0.0:
        return "thin_positive_ev_at_real_quote"
    if real_ev >= -0.05:
        return "near_breakeven_at_real_quote"
    return "negative_ev_at_real_quote"


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).replace(",", ".")
    try:
        return float(text)
    except (TypeError, ValueError):
        return None
