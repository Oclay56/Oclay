"""The Odds API adapter -- parsing, consensus, and fetch reshaping (no network)."""

from __future__ import annotations

import asyncio

from app.odds_api import fetch_sharp_lines, parse_event_odds


def _single_book_event(event_id="evt1"):
    return {
        "id": event_id,
        "bookmakers": [
            {
                "key": "betmgm",
                "markets": [
                    {
                        "key": "batter_total_bases",
                        "last_update": "2026-06-14T22:00:00Z",
                        "outcomes": [
                            {"name": "Over", "description": "Aaron Judge", "price": 1.95, "point": 1.5},
                            {"name": "Under", "description": "Aaron Judge", "price": 1.95, "point": 1.5},
                        ],
                    },
                    {  # unmapped market -> skipped
                        "key": "batter_doubles",
                        "outcomes": [{"name": "Over", "description": "X", "price": 2.0, "point": 0.5}],
                    },
                ],
            }
        ],
    }


def test_parse_maps_markets_and_pairs_two_way_prices():
    entries = parse_event_odds(_single_book_event(), bookmaker="betmgm")
    judge = next(e for e in entries if e["player"] == "Aaron Judge")
    assert judge["market"] == "total_bases"
    assert judge["over"] == 1.95 and judge["under"] == 1.95
    assert judge["line"] == 1.5
    assert judge["book"] == "betmgm"
    assert not any(e["market"] == "batter_doubles" for e in entries)


def test_parse_consensus_takes_the_median_across_books():
    event = {
        "id": "e",
        "bookmakers": [
            {"key": "betmgm", "markets": [{"key": "batter_hits", "last_update": "t1", "outcomes": [
                {"name": "Over", "description": "A", "price": 2.0, "point": 0.5},
                {"name": "Under", "description": "A", "price": 1.8, "point": 0.5}]}]},
            {"key": "draftkings", "markets": [{"key": "batter_hits", "last_update": "t2", "outcomes": [
                {"name": "Over", "description": "A", "price": 2.2, "point": 0.5},
                {"name": "Under", "description": "A", "price": 1.7, "point": 0.5}]}]},
        ],
    }
    entries = parse_event_odds(event, bookmaker="consensus")
    assert len(entries) == 1
    e = entries[0]
    assert e["market"] == "hits" and e["player"] == "A"
    assert e["over"] == 2.1   # median(2.0, 2.2)
    assert e["under"] == 1.75  # median(1.8, 1.7)
    assert e["book"] == "consensus_2"


def test_pitcher_strikeouts_emitted_under_both_canonical_keys():
    event = {
        "id": "e",
        "bookmakers": [{"key": "betmgm", "markets": [{
            "key": "pitcher_strikeouts",
            "outcomes": [
                {"name": "Over", "description": "Gerrit Cole", "price": 1.9, "point": 6.5},
                {"name": "Under", "description": "Gerrit Cole", "price": 1.9, "point": 6.5},
            ],
        }]}],
    }
    markets = {e["market"] for e in parse_event_odds(event, bookmaker="betmgm")}
    assert "strikeouts" in markets and "pitcher_strikeouts" in markets


class _Resp:
    def __init__(self, data, headers=None):
        self._data = data
        self.headers = headers or {}

    def json(self):
        return self._data

    def raise_for_status(self):
        return None


class _FakeClient:
    def __init__(self, events, odds):
        self.events = events
        self.odds = odds
        self.calls: list[str] = []

    async def get(self, url, params=None):
        self.calls.append(url)
        if url.endswith("/events"):
            return _Resp(self.events)
        event_id = url.split("/events/")[1].split("/odds")[0]
        return _Resp(self.odds[event_id], {"x-requests-remaining": "480"})

    async def aclose(self):
        return None


def _simple_event(event_id):
    return {
        "id": event_id,
        "bookmakers": [{"key": "betmgm", "markets": [{"key": "batter_hits", "last_update": "t", "outcomes": [
            {"name": "Over", "description": "A", "price": 2.0, "point": 0.5},
            {"name": "Under", "description": "A", "price": 1.8, "point": 0.5}]}]}],
    }


def test_fetch_walks_events_then_pulls_each_events_odds():
    events = [{"id": "evt1"}, {"id": "evt2"}]
    odds = {"evt1": _simple_event("evt1"), "evt2": _simple_event("evt2")}
    client = _FakeClient(events, odds)

    result = asyncio.run(fetch_sharp_lines(api_key="test-key", http_client=client))

    assert result["events"] == 2
    assert result["requestsRemaining"] == "480"
    assert len(result["entries"]) == 2  # one consensus prop per event
    assert sum(1 for url in client.calls if "/odds" in url) == 2


def test_fetch_without_a_key_is_a_clean_no_op():
    result = asyncio.run(fetch_sharp_lines(api_key=""))
    assert result["error"] == "no_api_key"
    assert result["entries"] == []
