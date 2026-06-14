"""Stale-line / latency edge -- flag props whose line predates fresh info.

Soft books are slow to move prop lines after a discrete information event. The
cleanest of these is the moment the real lineup posts: before it, Stake prices a
projected lineup; after it, any player whose confirmed batting slot (and thus
plate-appearance volume) differs from the projection has a line that hasn't
caught up yet. Weather (wind/temperature on power props) is the same story, just
continuous.

OCLAY already ingests confirmed lineups and weather and folds them into the
per-game mean (see ``matchup_model.sharpen_mean``). So when a *fresh-info*
adjustment moved the mean materially in the same direction as the model's edge
over Stake's current line, the line most likely hasn't repriced -- a latency
edge: real value that comes from being faster, not smarter.

This is intentionally high-precision: it requires a discrete info event (a
*confirmed* lineup slot, or a material weather shift), that the shift and the
model edge point the same way as the bet side, and that the edge is material.
A line that already reflects the info shows no edge, so it never fires.
"""

from __future__ import annotations

from typing import Any


# Mean-adjustment sources that represent recent, slowly-priced information.
# The weight scales how much each contributes to the staleness magnitude: a
# confirmed lineup slot is a discrete, timestampable event (full weight); weather
# is continuous and partially priced, so it counts for less.
_FRESH_SOURCES = {"lineup_spot_pa_volume": 1.0, "weather": 0.7}

_MIN_FACTOR_SHIFT = 0.03   # the info must have moved the mean at least this much
_MIN_EDGE = 0.03           # the model must beat the line by at least this much
_SHIFT_SATURATION = 0.10   # a 10% net info shift saturates the magnitude term
_EDGE_SATURATION = 0.10    # a 10% model edge saturates the edge term
_SCORE_BONUS_CAP = 6.0     # max merit bonus for a maximally stale line


def _float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _not_stale(**extra: Any) -> dict[str, Any]:
    return {"isStale": False, "stalenessScore": 0.0, "scoreBonus": 0.0, **extra}


def detect_stale_line(
    candidate: dict[str, Any], assessment: dict[str, Any] | None
) -> dict[str, Any]:
    """Flag a prop whose line likely predates fresh lineup/weather info.

    Returns a signal dict; ``isStale`` is True only when a discrete info event
    moved the mean toward this bet's side and the model still shows a material
    edge over Stake's current line (so the line hasn't caught up).
    """
    assessment = assessment or {}
    side = str(candidate.get("side") or "").lower()
    if side not in {"over", "under"}:
        return _not_stale()

    lineup = candidate.get("lineupContext") or {}
    lineup_confirmed = bool(lineup.get("lineupConfirmed"))
    adjustments = ((assessment.get("inputs") or {}).get("meanAdjustments")) or []
    edge = _float(assessment.get("edge"))

    events: list[dict[str, Any]] = []
    over_shift = 0.0  # net signed mean shift toward OVER (sum of weighted factor-1)
    for adj in adjustments:
        source = str(adj.get("source") or "")
        weight = _FRESH_SOURCES.get(source)
        if weight is None:
            continue
        # A lineup-slot shift is only "fresh" once the lineup is actually posted.
        if source == "lineup_spot_pa_volume" and not lineup_confirmed:
            continue
        factor = _float(adj.get("factor"))
        if factor is None:
            continue
        shift = factor - 1.0
        if abs(shift) < _MIN_FACTOR_SHIFT:
            continue
        over_shift += weight * shift
        events.append(
            {
                "source": source,
                "factor": round(factor, 4),
                "favors": "over" if shift > 0 else "under",
                "battingOrder": lineup.get("battingOrder")
                if source == "lineup_spot_pa_volume"
                else None,
            }
        )

    if not events or abs(over_shift) < 1e-9:
        return _not_stale()

    info_side = "over" if over_shift > 0 else "under"
    aligned = info_side == side
    edge_ok = edge is not None and edge >= _MIN_EDGE
    if not (aligned and edge_ok):
        # The info exists but doesn't support this side with a model edge -- not
        # actionable (the line may already reflect it).
        return _not_stale(events=events, infoSide=info_side, aligned=aligned)

    magnitude = min(1.0, abs(over_shift) / _SHIFT_SATURATION)
    edge_strength = min(1.0, (edge or 0.0) / _EDGE_SATURATION)
    score = round(0.5 * magnitude + 0.5 * edge_strength, 4)
    has_lineup = any(e["source"] == "lineup_spot_pa_volume" for e in events)
    trigger = "confirmed_lineup_slot" if has_lineup else "weather_shift"
    return {
        "isStale": True,
        "stalenessScore": score,
        "scoreBonus": round(_SCORE_BONUS_CAP * score, 2),
        "direction": side,
        "trigger": trigger,
        "events": events,
        "edge": round(edge, 4) if edge is not None else None,
        "note": (
            f"Fresh {trigger.replace('_', ' ')} moved the model {side}, but Stake's line "
            "has not repriced -- likely stale. Latency edge: act before it moves."
        ),
    }
