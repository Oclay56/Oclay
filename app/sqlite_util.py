"""Shared SQLite housekeeping helpers."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any


# PRAGMA auto_vacuum integer modes.
_AUTO_VACUUM_FULL = 1


def ensure_auto_vacuum_full(db_path: str | Path) -> None:
    """Put a SQLite database into auto_vacuum=FULL mode (idempotent).

    In FULL mode, freed pages are returned to the OS on every delete-commit, so
    the file self-tightens as rows are pruned instead of holding its high-water
    mark. Adding rows never triggers it (there is nothing to reclaim) -- only
    deletes do. Switching the mode on a database that already has data requires a
    one-time VACUUM; once the mode is FULL this is just a cheap PRAGMA read.
    """
    path = Path(db_path)
    if path.parent and not path.parent.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
    # Autocommit (isolation_level=None) so VACUUM is not inside a transaction.
    conn = sqlite3.connect(str(path), isolation_level=None)
    try:
        mode = conn.execute("PRAGMA auto_vacuum").fetchone()[0]
        if int(mode) != _AUTO_VACUUM_FULL:
            conn.execute("PRAGMA auto_vacuum=FULL")
            conn.execute("VACUUM")
    finally:
        conn.close()


def auto_vacuum_mode(db_path: str | Path) -> Any:
    """Return the current auto_vacuum mode (0=NONE, 1=FULL, 2=INCREMENTAL)."""
    conn = sqlite3.connect(str(db_path))
    try:
        return conn.execute("PRAGMA auto_vacuum").fetchone()[0]
    finally:
        conn.close()
