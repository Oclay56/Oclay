"""Avenue 2 -- line-shopping against a sharp book.

The strongest, most reliable edge in betting does not come from out-modeling the
sport; it comes from a soft book pricing a market differently than a sharp one.
A sharp book (Pinnacle / the sharp consensus) runs low margin and high limits and
is moved by professional money, so its **no-vig** price is the best available
estimate of the true probability. When Stake -- a recreational book -- prices the
same prop differently, the gap is edge.

This module compares each Stake candidate to a matching sharp line, strips the
vig from the sharp two-way price to get the true probability, and reports the
edge versus what Stake's price implies:

    edge = sharpFairProbability - stakeImpliedProbability      (> 0 -> bet)

It is a *real-time* comparison (both lines exist now), so unlike a closing-line
measurement it needs no waiting -- and acting earlier, before Stake repositions,
is often where the biggest gaps are.

The feed is pluggable and the module degrades gracefully: with no sharp data it
simply reports no signal, exactly like the other edge layers when starved. Drop
a sharp-lines snapshot in (``OCLAY_SHARP_LINES_PATH`` JSON, or the
``/oclay/sharp-lines`` ingest endpoint) and the whole pipeline lights up.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from .mlb_props import slug_key
from .probability_engine import devig_two_way, implied_probability


_ENV_PATH = "OCLAY_SHARP_LINES_PATH"
_ENV_DISABLE = "OCLAY_DISABLE_SHARP_LINES"
_CACHE_SECONDS = 120.0  # sharp lines move; keep the cache short

# A Stake price this much better than the sharp no-vig probability is a real
# overlay; this much worse is a trap. Between the two it is fairly priced.
SHARP_EDGE_THRESHOLD = 0.02
SHARP_EDGE_SATURATION = 0.08  # an 8% edge saturates the merit bonus
SHARP_SCORE_BONUS_CAP = 8.0   # strongest edge -> the largest single merit bonus

_cache: dict[str, Any] = {"loadedAt": 0.0, "lines": {}, "path": None}


def _float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _player_slug(player: Any) -> str:
    if isinstance(player, dict):
        return slug_key(player.get("key") or player.get("name"))
    return slug_key(player)


def sharp_key(player: Any, market: Any, line: Any) -> str:
    """Normalized lookup key shared by the candidate side and the sharp feed."""
    market_key = str(market or "").strip().lower().replace("-", "_")
    line_value = _float(line)
    line_text = f"{line_value:g}" if line_value is not None else ""
    return f"{_player_slug(player)}|{market_key}|{line_text}"


def normalize_sharp_entries(entries: Any) -> dict[str, dict[str, Any]]:
    """Build the keyed sharp-lines table a feed dump (list of rows) provides.

    Each row carries player, market, line, and the two-way ``over`` / ``under``
    decimal odds (plus optional book / capturedAt). Pre-keyed dicts pass through.
    """
    if isinstance(entries, dict):
        return {str(k): dict(v) for k, v in entries.items() if isinstance(v, dict)}
    table: dict[str, dict[str, Any]] = {}
    for row in entries or []:
        if not isinstance(row, dict):
            continue
        key = sharp_key(row.get("player"), row.get("market") or row.get("normalizedMarketKey"), row.get("line"))
        over = _float(row.get("over"))
        under = _float(row.get("under"))
        if over is None and under is None:
            continue
        table[key] = {
            "over": over,
            "under": under,
            "book": row.get("book"),
            "capturedAt": row.get("capturedAt"),
        }
    return table


def get_active_sharp_lines(*, force_reload: bool = False) -> dict[str, dict[str, Any]]:
    """Load the sharp-lines table from ``OCLAY_SHARP_LINES_PATH``, cached.

    Returns an empty table when disabled, unset, or missing -- the signal then
    simply does not fire (no faulty behavior, just no data yet).
    """
    if os.getenv(_ENV_DISABLE, "").strip().lower() in {"1", "true", "yes"}:
        return {}
    path = os.getenv(_ENV_PATH, "").strip()
    now = time.monotonic()
    if (
        not force_reload
        and _cache["path"] == path
        and now - _cache["loadedAt"] < _CACHE_SECONDS
    ):
        return dict(_cache["lines"])
    lines: dict[str, dict[str, Any]] = {}
    if path and os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                lines = normalize_sharp_entries(json.load(handle))
        except (OSError, ValueError):
            lines = {}
    _cache.update({"loadedAt": now, "lines": lines, "path": path})
    return dict(lines)


def record_sharp_lines(entries: Any) -> dict[str, Any]:
    """Persist a sharp-lines snapshot to the configured path and refresh cache."""
    table = normalize_sharp_entries(entries)
    path = os.getenv(_ENV_PATH, "").strip()
    written = False
    if path:
        try:
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(table, handle)
            written = True
        except OSError:
            written = False
    # Even without a path, hold the snapshot in cache for this process so the
    # current scan can use it immediately.
    _cache.update({"loadedAt": time.monotonic(), "lines": table, "path": path})
    return {"entries": len(table), "persisted": written, "path": path or None}


def invalidate_sharp_lines_cache() -> None:
    _cache.update({"loadedAt": 0.0, "lines": {}, "path": None})


def _no_signal(**extra: Any) -> dict[str, Any]:
    return {"matched": False, "edge": None, "scoreBonus": 0.0, **extra}


def sharp_line_edge(
    candidate: dict[str, Any], *, sharp_lines: dict[str, dict[str, Any]] | None = None
) -> dict[str, Any]:
    """Edge of a Stake candidate versus the sharp no-vig probability.

    Looks up the matching sharp two-way price, devigs it to the true probability
    for the bet side, and compares to Stake's implied probability. ``matched`` is
    False (no signal) when there is no sharp line for the exact player/market/line
    -- sharp books cover fewer props than Stake, so partial coverage is expected.
    """
    side = str(candidate.get("side") or "").lower()
    if side not in {"over", "under"}:
        return _no_signal()
    stake_odds = _float(candidate.get("odds"))
    if stake_odds is None or stake_odds <= 1.0:
        return _no_signal()

    table = sharp_lines if sharp_lines is not None else get_active_sharp_lines()
    if not table:
        return _no_signal(reason="no_sharp_data")

    key = sharp_key(candidate.get("player"), candidate.get("normalizedMarketKey"), candidate.get("line"))
    entry = table.get(key)
    if not entry:
        return _no_signal(reason="no_sharp_line_for_prop", key=key)

    side_odds = _float(entry.get(side))
    opposite_odds = _float(entry.get("under" if side == "over" else "over"))
    if side_odds is None:
        return _no_signal(reason="sharp_side_missing", key=key)

    devig = devig_two_way(side_odds, opposite_odds)
    sharp_fair = devig.get("fairProbability")
    stake_implied = implied_probability(stake_odds)
    if sharp_fair is None or stake_implied is None:
        return _no_signal(reason="devig_unavailable", key=key)

    edge = round(sharp_fair - stake_implied, 4)
    if edge >= SHARP_EDGE_THRESHOLD:
        direction = "beats_sharp_consensus"
        interpretation = (
            "Stake's price is better than the sharp no-vig line -- a real overlay; "
            "the sharpest market on the board rates this side likelier than Stake pays for."
        )
    elif edge <= -SHARP_EDGE_THRESHOLD:
        direction = "worse_than_sharp_consensus"
        interpretation = (
            "Stake's price is worse than the sharp no-vig line -- you would be "
            "paying over the sharpest available estimate; avoid."
        )
    else:
        direction = "in_line_with_sharp"
        interpretation = "Stake's price matches the sharp no-vig line -- no line-shopping edge."

    magnitude = min(1.0, max(0.0, edge) / SHARP_EDGE_SATURATION)
    bonus = round(SHARP_SCORE_BONUS_CAP * magnitude, 2)
    return {
        "matched": True,
        "edge": edge,
        "direction": direction,
        "sharpFairProbability": round(sharp_fair, 4),
        "stakeImpliedProbability": round(stake_implied, 4),
        "sharpOdds": side_odds,
        "devigMethod": devig.get("method"),
        "book": entry.get("book"),
        "capturedAt": entry.get("capturedAt"),
        "scoreBonus": bonus if direction == "beats_sharp_consensus" else 0.0,
        "interpretation": interpretation,
    }
