"""One-off: explain *why* each pending leg won't grade.

For every pending pick, fetch that player's MLB game log and show which dates
it actually contains around the logged slate_date. This distinguishes a
date-skew mismatch (the game IS in the log, under a neighbouring date) from a
genuine DNP (no line exists at all).
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta

from app.grading import (
    _season_from_date,
    _game_on_date,
)
from app.mlb_bridge import stat_mapping_for_market, stat_value_from_stats
from app.mlb_data import MLBDataEngine, MLBStatsClient, build_mlb_http_client
from app.pick_ledger import PickLedger


def _around(target: str, n: int = 3) -> set[str]:
    try:
        d = date.fromisoformat(target[:10])
    except ValueError:
        return set()
    return {(d + timedelta(days=k)).isoformat() for k in range(-n, n + 1)}


async def main() -> None:
    ledger = PickLedger()
    pending = ledger.pending_picks()
    print(f"Pending picks: {len(pending)}\n")

    async with build_mlb_http_client() as http_client:
        engine = MLBDataEngine(MLBStatsClient(http_client))
        cache: dict[tuple, dict] = {}

        for pick in pending:
            player = pick.get("player")
            slate = str(pick.get("slate_date") or "")[:10]
            market = str(pick.get("market_key") or "")
            side = pick.get("side")
            line = pick.get("line")
            pid = pick.get("mlb_person_id")
            mapping = stat_mapping_for_market(market)
            group = str(mapping.get("group") or "hitting")
            season = _season_from_date(slate)

            print("=" * 72)
            print(f"{player}  |  {market} {side} {line}  |  slate {slate}  | id={pid}")

            if pid is None:
                print("  -> NO mlb_person_id on the leg; can't fetch a game log.")
                continue

            key = (pid, group, season)
            history = cache.get(key)
            if history is None:
                try:
                    history = await engine.get_player_recent_history(
                        pid, group=group, season=season, limit=40
                    )
                except Exception as exc:  # noqa: BLE001
                    print(f"  -> fetch error: {exc!r}")
                    continue
                cache[key] = history or {}

            games = (history or {}).get("games") or []
            print(f"  game-log rows this season ({group}, {season}): {len(games)}")

            exact = _game_on_date(history, slate)
            if exact is not None:
                stat_ref = mapping if mapping.get("statFormula") else mapping.get("statKey")
                val = stat_value_from_stats(stat_ref, exact.get("stats") or {})
                print(f"  -> EXACT date row EXISTS, stat value={val} "
                      f"(this SHOULD grade -- investigate why it didn't)")
                continue

            window = _around(slate, 3)
            near = [g for g in games if str(g.get("date") or "")[:10] in window]
            if near:
                print("  -> NO exact-date row, but games exist nearby (DATE SKEW):")
                for g in sorted(near, key=lambda x: str(x.get("date"))):
                    stat_ref = mapping if mapping.get("statFormula") else mapping.get("statKey")
                    val = stat_value_from_stats(stat_ref, g.get("stats") or {})
                    print(f"       {str(g.get('date'))[:10]}  stat={val}")
            else:
                recent = sorted(
                    (str(g.get("date") or "")[:10] for g in games), reverse=True
                )[:5]
                print("  -> NO game on/near the slate date (likely DNP / scratch).")
                print(f"       most recent rows in log: {recent}")


if __name__ == "__main__":
    asyncio.run(main())
