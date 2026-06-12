from __future__ import annotations

import asyncio

from app.bet_history_import import parse_bet_history
from app.pick_ledger import PickLedger
from app.player_backfill import backfill_person_ids


SLIP = """2 Leg Same Game Multi

3.50
Atlanta Braves - Detroit Tigers

Thu, Apr 30 12:15 PM
Under 0.5 RBIs

Jake Rogers

0
1
Under 1.5 Total Bases

Riley Greene

8
2
"""


class FakeEngine:
    def __init__(self, by_name: dict[str, int]) -> None:
        self.by_name = by_name
        self.calls = 0

    async def search_players(self, query, limit=5):
        self.calls += 1
        person_id = self.by_name.get(query)
        if person_id is None:
            return {"players": []}
        return {"players": [{"name": query, "mlbId": person_id}]}


def _load(tmp_path) -> PickLedger:
    ledger = PickLedger(db_path=tmp_path / "l.sqlite")
    ledger.record_imported_slips(parse_bet_history(SLIP), season=2025)
    return ledger


def test_backfill_resolves_and_stores_ids(tmp_path):
    ledger = _load(tmp_path)
    assert sorted(ledger.players_missing_person_id()) == ["Jake Rogers", "Riley Greene"]

    engine = FakeEngine({"Jake Rogers": 111, "Riley Greene": 222})
    report = asyncio.run(backfill_person_ids(engine, ledger=ledger))

    assert report["playersResolved"] == 2
    assert report["picksUpdated"] == 2
    assert report["unresolvedCount"] == 0
    # The ids are now stored, so nothing is left to resolve.
    assert ledger.players_missing_person_id() == []


def test_backfill_reports_unresolved_without_guessing(tmp_path):
    ledger = _load(tmp_path)
    engine = FakeEngine({"Jake Rogers": 111})  # Riley Greene not found

    report = asyncio.run(backfill_person_ids(engine, ledger=ledger))

    assert report["playersResolved"] == 1
    assert report["unresolved"] == ["Riley Greene"]
    # The unresolved player keeps no id rather than a wrong one.
    assert ledger.players_missing_person_id() == ["Riley Greene"]
