"""The Odds API adapter -- pulls sharp MLB prop lines for Avenue 2.

Fetches MLB player-prop odds from a sharp bookmaker (Pinnacle by default) via
The Odds API and reshapes them into the sharp-lines snapshot the line-shopping
detector consumes (``app.sharp_lines``). On The Odds API player props are read
one event at a time, so this lists the events, then pulls each event's prop
odds filtered to the sharp book and to decimal odds.

Cost note: event-odds requests are billed per market per region, so a refresh
costs roughly ``len(markets) x len(events)`` credits (the /events list is free).
The default market set is kept lean (the highest-value, best-covered batter
props); widen it with OCLAY_ODDS_API_MARKETS only if your quota allows.
"""

from __future__ import annotations

import os
import statistics
from typing import Any

import httpx

from .sharp_lines import record_sharp_lines


ODDS_API_BASE = "https://api.the-odds-api.com/v4"
MLB_SPORT_KEY = "baseball_mlb"
DEFAULT_REGION = "us"

# Pinnacle does not offer MLB player props through The Odds API (US), so the
# default reference is a *multi-book no-vig consensus*: per prop we take the
# median two-way price across the available books, which devigs to a market
# consensus probability. Stake landing well off that consensus is the edge.
# Set OCLAY_ODDS_API_BOOKMAKER to a single book key (e.g. "betmgm") to use just
# that book instead, or to a sharp book if one becomes available.
DEFAULT_BOOKMAKER = "consensus"
_CONSENSUS_KEYS = {"", "consensus", "all", "none"}

# The Odds API market key -> OCLAY canonical normalizedMarketKey (must match what
# the candidate pool emits, so sharp lines line up with Stake rows).
MARKET_MAP: dict[str, str] = {
    "batter_hits": "hits",
    "batter_total_bases": "total_bases",
    "batter_home_runs": "home_runs",
    "batter_rbis": "rbi",
    "batter_runs_scored": "runs",
    "batter_hits_runs_rbis": "hits_runs_rbis",
    "batter_singles": "singles",
    "batter_walks": "batter_walks",
    "batter_strikeouts": "batter_strikeouts",
    "pitcher_strikeouts": "strikeouts",
    "pitcher_hits_allowed": "hits_allowed",
    "pitcher_walks": "walks_allowed",
    "pitcher_earned_runs": "earned_runs",
    "pitcher_outs": "outs_recorded",
}

# Lean default: the highest-value, best-covered batter markets (5 credits/event).
DEFAULT_MARKETS = [
    "batter_hits",
    "batter_total_bases",
    "batter_home_runs",
    "batter_hits_runs_rbis",
    "batter_rbis",
]

# Pitcher strikeouts can normalize to either key on the Stake side; emit the
# sharp line under both so it matches whichever the candidate carries.
_ALSO_EMIT = {"strikeouts": ("pitcher_strikeouts",)}


def _env_markets() -> list[str]:
    raw = os.getenv("OCLAY_ODDS_API_MARKETS", "").strip()
    if raw:
        return [m.strip() for m in raw.split(",") if m.strip()]
    return list(DEFAULT_MARKETS)


def _median(values: list[float]) -> float | None:
    vals = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    return statistics.median(vals) if vals else None


def parse_event_odds(event: dict[str, Any], *, bookmaker: str | None) -> list[dict[str, Any]]:
    """Reshape one event-odds payload into sharp-line entries.

    Groups Over/Under outcomes by (player, market, line) into a two-way price and
    maps the market to OCLAY's canonical key. With ``bookmaker`` set to a single
    book key, uses just that book; otherwise (consensus) takes the median two-way
    price across every book that prices the prop. Unknown markets are skipped.
    """
    consensus = (bookmaker or "").strip().lower() in _CONSENSUS_KEYS
    # (player, oclay_market, line) -> list of per-book {over, under, book, lastUpdate}
    acc: dict[tuple[Any, str, Any], list[dict[str, Any]]] = {}
    for book in event.get("bookmakers") or []:
        book_key = book.get("key")
        if not consensus and book_key != bookmaker:
            continue
        for market in book.get("markets") or []:
            oclay_market = MARKET_MAP.get(str(market.get("key") or ""))
            if not oclay_market:
                continue
            grouped: dict[tuple[Any, Any], dict[str, Any]] = {}
            for outcome in market.get("outcomes") or []:
                player = outcome.get("description")
                point = outcome.get("point")
                side = str(outcome.get("name") or "").strip().lower()
                if player is None or point is None or side not in {"over", "under"}:
                    continue
                grouped.setdefault((player, point), {})[side] = outcome.get("price")
            for (player, point), sides in grouped.items():
                if "over" not in sides and "under" not in sides:
                    continue
                acc.setdefault((player, oclay_market, point), []).append(
                    {
                        "over": sides.get("over"),
                        "under": sides.get("under"),
                        "book": book_key,
                        "lastUpdate": market.get("last_update"),
                    }
                )

    entries: list[dict[str, Any]] = []
    for (player, oclay_market, point), rows in acc.items():
        overs = [r["over"] for r in rows if r["over"] is not None]
        unders = [r["under"] for r in rows if r["under"] is not None]
        if not overs and not unders:
            continue
        if consensus:
            book_label = f"consensus_{len(rows)}"
            captured = max((r["lastUpdate"] for r in rows if r["lastUpdate"]), default=None)
        else:
            book_label = rows[0]["book"]
            captured = rows[0]["lastUpdate"]
        base = {
            "player": player,
            "line": point,
            "over": _median(overs),
            "under": _median(unders),
            "book": book_label,
            "capturedAt": captured,
        }
        for market_key in (oclay_market, *_ALSO_EMIT.get(oclay_market, ())):
            entries.append({**base, "market": market_key})
    return entries


async def fetch_sharp_lines(
    api_key: str | None = None,
    *,
    http_client: Any | None = None,
    sport: str = MLB_SPORT_KEY,
    bookmaker: str | None = None,
    markets: list[str] | None = None,
    region: str = DEFAULT_REGION,
    max_events: int | None = None,
) -> dict[str, Any]:
    """Fetch sharp MLB prop lines and return them in sharp-lines entry format."""
    api_key = api_key or os.getenv("OCLAY_ODDS_API_KEY", "").strip()
    if not api_key:
        return {"entries": [], "events": 0, "error": "no_api_key", "errors": []}
    bookmaker = bookmaker or os.getenv("OCLAY_ODDS_API_BOOKMAKER", DEFAULT_BOOKMAKER) or None
    markets = markets or _env_markets()

    own_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=20.0)
    entries: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    requests_remaining: Any = None
    try:
        try:
            events_resp = await client.get(
                f"{ODDS_API_BASE}/sports/{sport}/events",
                params={"apiKey": api_key, "dateFormat": "iso"},
            )
            events_resp.raise_for_status()
            events = events_resp.json() or []
        except httpx.HTTPError as exc:
            # The events list is free, so this is usually a bad key or a network
            # blip -- return a clean status instead of raising into the caller.
            return {
                "entries": [],
                "events": 0,
                "bookmaker": bookmaker,
                "markets": markets,
                "requestsRemaining": None,
                "errors": [{"stage": "events", "error": str(exc)}],
                "error": "events_fetch_failed",
            }
        if max_events:
            events = events[: int(max_events)]
        for event in events:
            event_id = event.get("id")
            if not event_id:
                continue
            params = {
                "apiKey": api_key,
                "regions": region,
                "markets": ",".join(markets),
                "oddsFormat": "decimal",
                "dateFormat": "iso",
            }
            # Consensus pulls every book in the region; a named book filters to it.
            if (bookmaker or "").strip().lower() not in _CONSENSUS_KEYS:
                params["bookmakers"] = bookmaker
            try:
                resp = await client.get(
                    f"{ODDS_API_BASE}/sports/{sport}/events/{event_id}/odds",
                    params=params,
                )
                requests_remaining = resp.headers.get("x-requests-remaining", requests_remaining)
                resp.raise_for_status()
                entries.extend(parse_event_odds(resp.json(), bookmaker=bookmaker))
            except httpx.HTTPError as exc:
                errors.append({"eventId": event_id, "error": str(exc)})
        return {
            "entries": entries,
            "events": len(events),
            "bookmaker": bookmaker,
            "markets": markets,
            "requestsRemaining": requests_remaining,
            "errors": errors,
        }
    finally:
        if own_client:
            await client.aclose()


async def refresh_sharp_lines(
    api_key: str | None = None, *, http_client: Any | None = None, max_events: int | None = None
) -> dict[str, Any]:
    """Fetch sharp lines from The Odds API and load them for line-shopping.

    A refresh that comes back empty (out of credits, a network blip, or an empty
    slate) does NOT overwrite the snapshot already loaded -- line-shopping keeps
    using the last good lines and resumes cleanly when a later refresh succeeds.
    Nothing else in the system is affected either way; the signal just goes quiet.
    """
    fetched = await fetch_sharp_lines(api_key, http_client=http_client, max_events=max_events)
    entries = fetched.get("entries") or []
    if entries:
        recorded = record_sharp_lines(entries)
        kept_existing = False
    else:
        recorded = {"entries": 0, "persisted": False}
        kept_existing = True
    return {
        "ingested": recorded,
        "keptExistingLines": kept_existing,
        "events": fetched.get("events"),
        "bookmaker": fetched.get("bookmaker"),
        "markets": fetched.get("markets"),
        "requestsRemaining": fetched.get("requestsRemaining"),
        "errors": fetched.get("errors") or [],
        "error": fetched.get("error"),
    }
