from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .sqlite_util import ensure_auto_vacuum_full


DEFAULT_DB_PATH = Path("data") / "gpt_action.sqlite"


class GptActionStore:
    """Small local store for rebuildable OCLAY support data."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        configured_path = db_path or os.getenv("AZP_DB_PATH") or DEFAULT_DB_PATH
        self.db_path = Path(configured_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        ensure_auto_vacuum_full(self.db_path)
        self._ensure_schema()

    def save_market_mappings(self, mappings: list[dict[str, Any]]) -> dict[str, Any]:
        now = _utc_now()
        with self._connect() as conn:
            for mapping in mappings:
                conn.execute(
                    """
                    INSERT INTO market_mappings (
                        sport, stake_display_name, internal_market_key, stat_key,
                        group_name, last_seen_at, active, examples_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(sport, stake_display_name, internal_market_key)
                    DO UPDATE SET
                        stat_key = excluded.stat_key,
                        group_name = excluded.group_name,
                        last_seen_at = excluded.last_seen_at,
                        active = excluded.active,
                        examples_json = excluded.examples_json
                    """,
                    (
                        mapping.get("sport") or "mlb",
                        mapping.get("stakeDisplayName"),
                        mapping.get("internalMarketKey"),
                        mapping.get("statKey"),
                        mapping.get("group"),
                        now,
                        1 if mapping.get("active", True) else 0,
                        _json_dumps(mapping.get("examples") or []),
                    ),
                )
            conn.commit()
        return {"marketMappingsSaved": len(mappings), "capturedAt": now}

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS market_mappings (
                    sport TEXT NOT NULL,
                    stake_display_name TEXT NOT NULL,
                    internal_market_key TEXT NOT NULL,
                    stat_key TEXT,
                    group_name TEXT,
                    last_seen_at TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    examples_json TEXT NOT NULL DEFAULT '[]',
                    PRIMARY KEY (sport, stake_display_name, internal_market_key)
                );
                """
            )
            conn.commit()


SnapshotStore = GptActionStore


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
