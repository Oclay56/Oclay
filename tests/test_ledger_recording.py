from __future__ import annotations

from app.pick_ledger import PickLedger


def _ledger(tmp_path) -> PickLedger:
    return PickLedger(db_path=tmp_path / "ledger.sqlite")


def _pool(date):
    return {
        "mode": "best_available",
        "date": date,
        "rankedCandidates": [
            {
                "rowId": "r1",
                "player": "A",
                "normalizedMarketKey": "hits",
                "side": "over",
                "line": 0.5,
                "odds": 1.8,
            }
        ],
    }


def test_record_candidate_pool_skips_dateless_capture(tmp_path):
    ledger = _ledger(tmp_path)
    # No slate date anywhere -> nothing persisted (a dateless pick can never grade).
    result = ledger.record_candidate_pool(_pool(None), slate_date=None)
    assert result["picksRecorded"] == 0
    assert result["skipped"] == "no_slate_date"
    assert ledger.summary()["pendingPicks"] == 0


def test_record_candidate_pool_records_when_dated(tmp_path):
    ledger = _ledger(tmp_path)
    # Date supplied via the pool payload.
    assert ledger.record_candidate_pool(_pool("2026-06-13"))["picksRecorded"] == 1
    # Date supplied via the slate_date argument also works.
    assert ledger.record_candidate_pool(_pool(None), slate_date="2026-06-13")["picksRecorded"] == 0  # upsert, same key
    assert ledger.summary()["pendingPicks"] == 1
