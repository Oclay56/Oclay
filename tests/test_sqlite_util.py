"""auto_vacuum housekeeping: DBs self-tighten when rows are pruned."""

from __future__ import annotations

import sqlite3

from app.local_ui_bridge import LocalSqliteJobStore
from app.pick_ledger import PickLedger
from app.sqlite_util import auto_vacuum_mode, ensure_auto_vacuum_full

_FULL = 1


def test_ensure_auto_vacuum_full_on_fresh_db(tmp_path):
    db = tmp_path / "fresh.sqlite"
    ensure_auto_vacuum_full(db)
    assert auto_vacuum_mode(db) == _FULL


def test_ensure_auto_vacuum_converts_existing_db(tmp_path):
    db = tmp_path / "existing.sqlite"
    # Create a DB with data in the default mode (NONE).
    conn = sqlite3.connect(str(db))
    conn.execute("CREATE TABLE t (x TEXT)")
    conn.executemany("INSERT INTO t VALUES (?)", [("row",)] * 100)
    conn.commit()
    conn.close()
    assert auto_vacuum_mode(db) == 0  # NONE by default

    ensure_auto_vacuum_full(db)
    assert auto_vacuum_mode(db) == _FULL


def test_ensure_auto_vacuum_is_idempotent(tmp_path):
    db = tmp_path / "idem.sqlite"
    ensure_auto_vacuum_full(db)
    ensure_auto_vacuum_full(db)  # second call is a cheap no-op
    assert auto_vacuum_mode(db) == _FULL


def test_pick_ledger_uses_full_auto_vacuum(tmp_path):
    ledger = PickLedger(db_path=tmp_path / "ledger.sqlite")
    assert auto_vacuum_mode(ledger.db_path) == _FULL


def test_job_store_uses_full_auto_vacuum(tmp_path):
    store = LocalSqliteJobStore(db_path=tmp_path / "jobs.sqlite")
    store.enabled()  # triggers schema + auto_vacuum setup
    assert auto_vacuum_mode(store.db_path) == _FULL
