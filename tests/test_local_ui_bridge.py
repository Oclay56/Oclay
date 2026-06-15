"""LocalSqliteJobStore: the local SQLite job queue that replaced Supabase."""

from __future__ import annotations

import asyncio

import pytest

from app.local_ui_bridge import LocalSqliteJobStore, LocalUiBridgeError


def _store(tmp_path) -> LocalSqliteJobStore:
    return LocalSqliteJobStore(db_path=tmp_path / "jobs.sqlite")


def test_create_claim_complete_round_trip(tmp_path):
    store = _store(tmp_path)

    created = asyncio.run(
        store.create_job(
            job_type="stake_ui_sgm_board",
            request={"fixtureSlug": "abc"},
            timeout_seconds=30,
        )
    )
    assert created["status"] == "pending"
    assert created["request"] == {"fixtureSlug": "abc"}

    claimed = asyncio.run(
        store.claim_next_pending_job(worker_id="w1", job_type="stake_ui_sgm_board")
    )
    assert claimed is not None
    assert claimed["jobId"] == created["jobId"]
    assert claimed["status"] == "running"
    assert claimed["workerId"] == "w1"

    done = asyncio.run(store.complete_job(created["jobId"], {"ok": True}))
    assert done["status"] == "completed"
    assert done["result"] == {"ok": True}

    fetched = asyncio.run(store.get_job(created["jobId"]))
    assert fetched["status"] == "completed"


def test_claim_is_exclusive_across_two_claims(tmp_path):
    store = _store(tmp_path)
    asyncio.run(
        store.create_job(job_type="t", request={}, timeout_seconds=30)
    )
    first = asyncio.run(store.claim_next_pending_job(worker_id="a", job_type="t"))
    second = asyncio.run(store.claim_next_pending_job(worker_id="b", job_type="t"))
    assert first is not None
    assert second is None  # the single pending job was already claimed


def test_wait_returns_completed_result(tmp_path):
    store = _store(tmp_path)
    job = asyncio.run(store.create_job(job_type="t", request={}, timeout_seconds=30))
    asyncio.run(store.complete_job(job["jobId"], {"value": 1}))
    result = asyncio.run(
        store.wait_for_completed_result(job["jobId"], timeout_seconds=2, poll_interval_seconds=0.25)
    )
    assert result["status"] == "completed"
    assert result["result"] == {"value": 1}


def test_fail_job_marks_failed(tmp_path):
    store = _store(tmp_path)
    job = asyncio.run(store.create_job(job_type="t", request={}, timeout_seconds=30))
    failed = asyncio.run(store.fail_job(job["jobId"], "boom"))
    assert failed["status"] == "failed"
    assert failed["error"] == "boom"


def test_prune_deletes_finished_rows_past_retention(tmp_path):
    # retention 0 -> any finished row is immediately prunable.
    store = LocalSqliteJobStore(db_path=tmp_path / "jobs.sqlite", retention_seconds=0)
    job = asyncio.run(store.create_job(job_type="t", request={}, timeout_seconds=30))
    asyncio.run(store.complete_job(job["jobId"], {"ok": True}))
    pruned = asyncio.run(store.prune())
    assert pruned["prunedJobs"] >= 1
    with pytest.raises(LocalUiBridgeError):
        asyncio.run(store.get_job(job["jobId"]))


def test_enabled_true_for_writable_dir(tmp_path):
    assert _store(tmp_path).enabled() is True
