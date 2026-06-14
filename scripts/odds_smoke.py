"""One-off: confirm The Odds API returns MLB props and which book carries them.

Credit-conscious: lists events (free) then pulls ONE event's odds for two
markets (~2 credits). Loads OCLAY_ODDS_API_KEY from .env. Never prints the key.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import httpx

from app.odds_api import ODDS_API_BASE, MLB_SPORT_KEY, parse_event_odds


def _load_env() -> None:
    env = Path(__file__).resolve().parents[1] / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


async def main() -> None:
    _load_env()
    key = os.getenv("OCLAY_ODDS_API_KEY", "").strip()
    if not key:
        print("No OCLAY_ODDS_API_KEY in .env")
        return
    async with httpx.AsyncClient(timeout=20.0) as client:
        ev = await client.get(
            f"{ODDS_API_BASE}/sports/{MLB_SPORT_KEY}/events",
            params={"apiKey": key, "dateFormat": "iso"},
        )
        ev.raise_for_status()
        events = ev.json() or []
        print(f"MLB events available: {len(events)}  (events list is free)")
        if not events:
            print("No upcoming MLB events right now.")
            return
        first = events[0]
        print(f"Probing: {first.get('away_team')} @ {first.get('home_team')}  ({first.get('commence_time')})")
        odds = await client.get(
            f"{ODDS_API_BASE}/sports/{MLB_SPORT_KEY}/events/{first['id']}/odds",
            params={
                "apiKey": key,
                "regions": "us",
                "markets": "batter_hits,batter_total_bases",
                "oddsFormat": "decimal",
                "dateFormat": "iso",
            },
        )
        print("x-requests-remaining:", odds.headers.get("x-requests-remaining"))
        odds.raise_for_status()
        payload = odds.json()
        books = [b.get("key") for b in payload.get("bookmakers") or []]
        print("bookmakers returning these props:", books or "(none)")
        print("pinnacle present:", "pinnacle" in books)
        for book in books:
            n = len(parse_event_odds(payload, bookmaker=book))
            print(f"  {book}: {n} two-way prop lines parsed")


if __name__ == "__main__":
    asyncio.run(main())
