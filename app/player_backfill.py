"""One-time backfill of MLB person ids onto id-less picks.

Imported Stake history loads without player ids, so model validation has to
search MLB by name for every player on every run -- hundreds of sequential
calls. This resolves each distinct name to its MLB id once and stores it on the
ledger, so future validation skips the search entirely.

It reads only from the free MLB Stats API and writes only to the local ledger;
Supabase is never touched. Names that cannot be confidently matched are left
id-less and reported, never guessed onto the wrong player.
"""

from __future__ import annotations

from typing import Any

from .mlb_props import slug_key
from .pick_ledger import PickLedger


async def backfill_person_ids(
    engine: Any,
    *,
    ledger: PickLedger | None = None,
) -> dict[str, Any]:
    """Resolve id-less picks' players to MLB ids and store them."""
    ledger = ledger or PickLedger()
    names = ledger.players_missing_person_id()
    resolved = 0
    picks_updated = 0
    unresolved: list[str] = []

    for name in names:
        person_id = await resolve_person_id(engine, name)
        if person_id is None:
            unresolved.append(name)
            continue
        updated = ledger.set_person_id_for_player(name, person_id)
        if updated > 0:
            resolved += 1
            picks_updated += updated

    return {
        "purpose": "oclay_player_id_backfill",
        "playersConsidered": len(names),
        "playersResolved": resolved,
        "picksUpdated": picks_updated,
        "unresolvedCount": len(unresolved),
        "unresolved": sorted(unresolved),
    }


async def resolve_person_id(engine: Any, name: str) -> int | None:
    """Resolve a player name to its MLB id, or None if not confidently matched."""
    key = slug_key(name)
    try:
        found = await engine.search_players(name, limit=5)
    except Exception:
        return None
    players = found.get("players") or []
    # Prefer an exact slug match; fall back to the top hit only if there is one.
    for player in players:
        if slug_key(player.get("name")) == key:
            return _int(player.get("mlbId"))
    if len(players) == 1:
        return _int(players[0].get("mlbId"))
    return None


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
