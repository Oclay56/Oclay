"""Best-effort backfill of per-leg odds from the live Stake fixture.

When the GPT logs a slip it normally includes each leg's own odds. If a leg
arrives without odds, this fills it from Stake's live fixture so per-market ROI
and the kill-switch have the real price -- not the combined parlay odds, and not
a guess. It is strictly fill-only (never overwrites odds the GPT supplied) and
strictly best-effort (any failure leaves the leg as-is and never blocks logging).

It only works while the fixture is still live on Stake; a settled game's prices
are gone, which is why historical imports cannot be backfilled this way.
"""

from __future__ import annotations

from typing import Any

from .mlb_props import slug_key
from .slate import flatten_player_prop_rows


def _f(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _leg_odds_from_rows(rows: list[dict[str, Any]], leg: dict[str, Any]) -> float | None:
    """Match a leg (player + market + line + side) to its odds in the flattened
    Stake prop rows. Returns the decimal odds for the chosen side, or None."""
    player = slug_key(str(leg.get("player") or ""))
    market = slug_key(str(leg.get("normalizedMarketKey") or leg.get("market") or ""))
    side = str(leg.get("side") or "").lower()
    line = _f(leg.get("line"))
    if not player or side not in ("over", "under") or line is None:
        return None
    for row in rows:
        if slug_key(str(row.get("player") or "")) != player:
            continue
        if market and slug_key(str(row.get("market") or "")) != market:
            continue
        if _f(row.get("line")) != line:
            continue
        odds = _f(row.get("over") if side == "over" else row.get("under"))
        if odds and odds > 1.0:
            return odds
    return None


async def fill_missing_leg_odds(client: Any, legs: list[Any]) -> int:
    """Fill odds on any leg that lacks them, from the live Stake fixture.

    Mutates the leg dicts in place. Returns how many were filled. Never raises.
    """
    missing = [
        leg
        for leg in legs
        if isinstance(leg, dict) and _f(leg.get("odds")) is None and leg.get("fixtureSlug")
    ]
    if not missing:
        return 0

    by_fixture: dict[str, list[dict[str, Any]]] = {}
    for leg in missing:
        by_fixture.setdefault(str(leg["fixtureSlug"]), []).append(leg)

    filled = 0
    for slug, group in by_fixture.items():
        try:
            odds = await client.get_odds(slug)
            rows = flatten_player_prop_rows(odds)
        except Exception:
            continue
        for leg in group:
            value = _leg_odds_from_rows(rows, leg)
            if value is not None:
                leg["odds"] = value
                filled += 1
    return filled
