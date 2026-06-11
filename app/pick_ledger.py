"""Pick ledger: the memory that lets OCLAY learn whether it is right.

Every reviewed candidate leg and every assembled slip is recorded here
with its estimated probability, the odds it was seen at, and enough
identity to grade it later against the real MLB box score. The grading
engine (app.grading) settles legs win/loss/push and records closing-line
value; the calibration engine (app.calibration) reads graded picks back
out to fit the per-market corrections that the probability engine then
applies. Without this table the scoring constants are unfalsifiable; with
it they become measurable and self-correcting.

Storage is SQLite by default (no external dependency, ships with Python)
and is intentionally append-friendly: a pick is logged at review time,
then updated in place when graded.
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


DEFAULT_LEDGER_PATH = Path("data") / "pick_ledger.sqlite"

GRADE_WIN = "win"
GRADE_LOSS = "loss"
GRADE_PUSH = "push"
GRADE_VOID = "void"
PENDING = "pending"


class PickLedger:
    """Append + grade store for picks, slips, and calibration corrections."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        configured = db_path or os.getenv("OCLAY_LEDGER_PATH") or DEFAULT_LEDGER_PATH
        self.db_path = Path(configured)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    # ------------------------------------------------------------------
    # Recording
    # ------------------------------------------------------------------
    def record_candidate_pool(
        self,
        pool: dict[str, Any],
        *,
        slate_date: str | None = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        """Persist every ranked candidate from a pool response as a pick.

        Picks are keyed by ``slate_date:row_id`` so repeated pool calls on
        the same day upsert rather than duplicate, and the full scored pool
        is graded later (not just selected legs) to keep calibration free of
        selection bias.
        """
        run_id = run_id or _new_id("run")
        mode = str(pool.get("mode") or "best_available")
        date = slate_date or pool.get("date")
        namespace = str(date) if date else run_id
        rows = [row for row in (pool.get("rankedCandidates") or []) if isinstance(row, dict)]
        recorded = 0
        now = _utc_now()
        with self._connect() as conn:
            for row in rows:
                recorded += self._insert_pick(
                    conn, row, run_id=run_id, mode=mode, date=date, now=now, namespace=namespace
                )
            conn.commit()
        return {
            "runId": run_id,
            "picksRecorded": recorded,
            "candidateCount": len(rows),
            "namespace": namespace,
        }

    def record_slip(
        self,
        slip: dict[str, Any],
        *,
        slate_date: str | None = None,
        mode: str | None = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        """Persist an assembled slip and its legs for slip-level scoring."""
        slip_id = str(slip.get("slipId") or _new_id("slip"))
        legs = [leg for leg in (slip.get("legs") or []) if isinstance(leg, dict)]
        namespace = str(slate_date) if slate_date else (run_id or slip_id)
        now = _utc_now()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO slips (
                    slip_id, run_id, slate_date, mode, leg_count, raw_product_odds,
                    estimated_win_probability, expected_value, created_at, graded_at, result
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                ON CONFLICT(slip_id) DO UPDATE SET
                    leg_count = excluded.leg_count,
                    raw_product_odds = excluded.raw_product_odds,
                    estimated_win_probability = excluded.estimated_win_probability,
                    expected_value = excluded.expected_value
                """,
                (
                    slip_id,
                    run_id,
                    slate_date,
                    mode or slip.get("mode"),
                    _int_or_none(slip.get("legCount")) or len(legs),
                    _float_or_none(slip.get("rawProductOdds")),
                    _float_or_none((slip.get("slipProbability") or {}).get("estimatedWinProbability")),
                    _float_or_none((slip.get("slipProbability") or {}).get("expectedValue")),
                    now,
                    PENDING,
                ),
            )
            for index, leg in enumerate(legs):
                self._insert_pick(
                    conn,
                    leg,
                    run_id=run_id,
                    mode=mode or slip.get("mode") or "best_available",
                    date=slate_date,
                    now=now,
                    namespace=namespace,
                )
                conn.execute(
                    """
                    INSERT INTO slip_legs (slip_id, leg_index, row_id, pick_key)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(slip_id, leg_index) DO UPDATE SET
                        row_id = excluded.row_id, pick_key = excluded.pick_key
                    """,
                    (slip_id, index, leg.get("rowId"), _pick_key(leg, namespace)),
                )
            conn.commit()
        return {"slipId": slip_id, "legsRecorded": len(legs)}

    def _insert_pick(
        self,
        conn: sqlite3.Connection,
        row: dict[str, Any],
        *,
        run_id: str,
        mode: str,
        date: str | None,
        now: str,
        namespace: str | None = None,
    ) -> int:
        probability = row.get("probabilityAssessment") or {}
        pick_key = _pick_key(row, namespace or run_id)
        cursor = conn.execute(
            """
            INSERT INTO picks (
                pick_key, run_id, slate_date, mode, fixture_slug, matchup, row_id,
                mlb_person_id, player, team, market_key, side, line, odds,
                implied_probability, fair_probability, estimated_probability, edge,
                edge_status, score, reliability_band, recorded_at,
                graded_at, outcome, actual_value, closing_odds, clv
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL)
            ON CONFLICT(pick_key) DO NOTHING
            """,
            (
                pick_key,
                run_id,
                date,
                mode,
                row.get("fixtureSlug"),
                row.get("matchup"),
                row.get("rowId"),
                _int_or_none(row.get("mlbPersonId")),
                row.get("player"),
                row.get("team"),
                _market_key(row),
                row.get("side"),
                _float_or_none(row.get("line")),
                _float_or_none(row.get("odds")),
                _float_or_none(probability.get("impliedProbability")),
                _float_or_none(probability.get("fairProbability")),
                _float_or_none(probability.get("estimatedProbability"))
                or _float_or_none(probability.get("adjustedEstimatedProbability")),
                _float_or_none(probability.get("edge")),
                probability.get("edgeStatus"),
                _float_or_none(row.get("score")),
                (probability.get("reliabilityBand") or row.get("reliabilityBand")),
                now,
                PENDING,
            ),
        )
        return 1 if cursor.rowcount > 0 else 0

    def record_closing_snapshot(self, snapshots: Iterable[dict[str, Any]]) -> dict[str, Any]:
        """Update pending picks with the odds seen near first pitch (for CLV)."""
        updated = 0
        with self._connect() as conn:
            for snap in snapshots:
                row_id = snap.get("rowId")
                closing = _float_or_none(snap.get("odds") or snap.get("closingOdds"))
                if not row_id or closing is None:
                    continue
                cur = conn.execute(
                    """
                    UPDATE picks SET closing_odds = ?
                    WHERE row_id = ? AND outcome = ? AND closing_odds IS NULL
                    """,
                    (closing, row_id, PENDING),
                )
                updated += cur.rowcount
            conn.commit()
        return {"closingSnapshotsApplied": updated}

    # ------------------------------------------------------------------
    # Grading
    # ------------------------------------------------------------------
    def pending_picks(self, *, slate_date: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM picks WHERE outcome = ?"
        params: list[Any] = [PENDING]
        if slate_date:
            query += " AND slate_date = ?"
            params.append(slate_date)
        with self._connect() as conn:
            return [dict(row) for row in conn.execute(query, params).fetchall()]

    def apply_grade(
        self,
        pick_key: str,
        *,
        outcome: str,
        actual_value: float | None,
    ) -> bool:
        clv = None
        now = _utc_now()
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT odds, closing_odds FROM picks WHERE pick_key = ?",
                (pick_key,),
            ).fetchone()
            if existing is not None:
                clv = _compute_clv(existing["odds"], existing["closing_odds"])
            cur = conn.execute(
                """
                UPDATE picks
                SET outcome = ?, actual_value = ?, graded_at = ?, clv = COALESCE(?, clv)
                WHERE pick_key = ?
                """,
                (outcome, actual_value, now, clv, pick_key),
            )
            conn.commit()
        return cur.rowcount > 0

    def settle_slips(self) -> dict[str, Any]:
        """Resolve slip results from their now-graded legs."""
        settled = 0
        with self._connect() as conn:
            slip_ids = [row["slip_id"] for row in conn.execute(
                "SELECT slip_id FROM slips WHERE result = ?", (PENDING,)
            ).fetchall()]
            for slip_id in slip_ids:
                legs = conn.execute(
                    """
                    SELECT p.outcome FROM slip_legs sl
                    JOIN picks p ON p.pick_key = sl.pick_key
                    WHERE sl.slip_id = ?
                    """,
                    (slip_id,),
                ).fetchall()
                outcomes = [str(leg["outcome"]) for leg in legs]
                if not outcomes or any(o == PENDING for o in outcomes):
                    continue
                effective = [o for o in outcomes if o not in {GRADE_PUSH, GRADE_VOID}]
                if not effective:
                    result = GRADE_PUSH
                elif all(o == GRADE_WIN for o in effective):
                    result = GRADE_WIN
                else:
                    result = GRADE_LOSS
                conn.execute(
                    "UPDATE slips SET result = ?, graded_at = ? WHERE slip_id = ?",
                    (result, _utc_now(), slip_id),
                )
                settled += 1
            conn.commit()
        return {"slipsSettled": settled}

    # ------------------------------------------------------------------
    # Read paths for calibration / reporting
    # ------------------------------------------------------------------
    def graded_picks(
        self,
        *,
        market_key: str | None = None,
        min_estimated: float | None = None,
    ) -> list[dict[str, Any]]:
        query = (
            "SELECT * FROM picks WHERE outcome IN (?, ?) AND estimated_probability IS NOT NULL"
        )
        params: list[Any] = [GRADE_WIN, GRADE_LOSS]
        if market_key:
            query += " AND market_key = ?"
            params.append(market_key)
        if min_estimated is not None:
            query += " AND estimated_probability >= ?"
            params.append(min_estimated)
        with self._connect() as conn:
            return [dict(row) for row in conn.execute(query, params).fetchall()]

    def save_calibrations(self, corrections: dict[str, dict[str, Any]]) -> int:
        now = _utc_now()
        with self._connect() as conn:
            for market_key, correction in corrections.items():
                conn.execute(
                    """
                    INSERT INTO calibrations (
                        market_key, intercept, slope, samples, brier, fitted_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(market_key) DO UPDATE SET
                        intercept = excluded.intercept,
                        slope = excluded.slope,
                        samples = excluded.samples,
                        brier = excluded.brier,
                        fitted_at = excluded.fitted_at
                    """,
                    (
                        market_key,
                        _float_or_none(correction.get("intercept")),
                        _float_or_none(correction.get("slope")),
                        _int_or_none(correction.get("samples")),
                        _float_or_none(correction.get("brier")),
                        now,
                    ),
                )
            conn.commit()
        return len(corrections)

    def load_calibrations(self) -> dict[str, dict[str, Any]]:
        with self._connect() as conn:
            try:
                rows = conn.execute("SELECT * FROM calibrations").fetchall()
            except sqlite3.OperationalError:
                return {}
        return {
            str(row["market_key"]): {
                "intercept": row["intercept"],
                "slope": row["slope"],
                "samples": row["samples"],
                "brier": row["brier"],
            }
            for row in rows
        }

    def save_market_policies(self, policies: dict[str, dict[str, Any]]) -> int:
        now = _utc_now()
        actionable = {
            market: policy
            for market, policy in policies.items()
            if policy.get("status") in {"exclude", "downweight", "ok"}
        }
        with self._connect() as conn:
            for market_key, policy in actionable.items():
                conn.execute(
                    """
                    INSERT INTO market_policy (
                        market_key, status, samples, realized_roi, hit_rate, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(market_key) DO UPDATE SET
                        status = excluded.status,
                        samples = excluded.samples,
                        realized_roi = excluded.realized_roi,
                        hit_rate = excluded.hit_rate,
                        updated_at = excluded.updated_at
                    """,
                    (
                        market_key,
                        policy.get("status"),
                        _int_or_none(policy.get("samples")),
                        _float_or_none(policy.get("realizedRoi")),
                        _float_or_none(policy.get("hitRate")),
                        now,
                    ),
                )
            conn.commit()
        return len(actionable)

    def load_market_policies(self) -> dict[str, dict[str, Any]]:
        with self._connect() as conn:
            try:
                rows = conn.execute("SELECT * FROM market_policy").fetchall()
            except sqlite3.OperationalError:
                return {}
        return {
            str(row["market_key"]): {
                "status": row["status"],
                "samples": row["samples"],
                "realizedRoi": row["realized_roi"],
                "hitRate": row["hit_rate"],
            }
            for row in rows
        }

    def graded_legs_by_game(self) -> list[list[dict[str, Any]]]:
        """Graded legs grouped by game, for measuring same-game co-hit rates."""
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT slate_date, fixture_slug, player, team, market_key, side, outcome
                FROM picks
                WHERE outcome IN (?, ?) AND fixture_slug IS NOT NULL AND fixture_slug != ''
                """,
                (GRADE_WIN, GRADE_LOSS),
            ).fetchall()
        games: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in rows:
            key = (str(row["slate_date"] or ""), str(row["fixture_slug"] or ""))
            games.setdefault(key, []).append(
                {
                    "fixtureSlug": row["fixture_slug"],
                    "player": row["player"],
                    "team": row["team"],
                    "normalizedMarketKey": row["market_key"],
                    "side": row["side"],
                    "win": 1 if row["outcome"] == GRADE_WIN else 0,
                }
            )
        return [legs for legs in games.values() if len(legs) >= 2]

    def save_correlation_estimates(self, estimates: dict[str, dict[str, Any]]) -> int:
        now = _utc_now()
        with self._connect() as conn:
            for category, estimate in estimates.items():
                conn.execute(
                    """
                    INSERT INTO correlation_estimates (category, rho, samples, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(category) DO UPDATE SET
                        rho = excluded.rho,
                        samples = excluded.samples,
                        updated_at = excluded.updated_at
                    """,
                    (
                        category,
                        _float_or_none(estimate.get("rho")),
                        _int_or_none(estimate.get("samples")),
                        now,
                    ),
                )
            conn.commit()
        return len(estimates)

    def load_correlation_estimates(self) -> dict[str, dict[str, Any]]:
        with self._connect() as conn:
            try:
                rows = conn.execute("SELECT * FROM correlation_estimates").fetchall()
            except sqlite3.OperationalError:
                return {}
        return {
            str(row["category"]): {"rho": row["rho"], "samples": row["samples"]}
            for row in rows
        }

    def summary(self) -> dict[str, Any]:
        with self._connect() as conn:
            total = conn.execute("SELECT COUNT(*) AS c FROM picks").fetchone()["c"]
            graded = conn.execute(
                "SELECT COUNT(*) AS c FROM picks WHERE outcome IN (?, ?)",
                (GRADE_WIN, GRADE_LOSS),
            ).fetchone()["c"]
            wins = conn.execute(
                "SELECT COUNT(*) AS c FROM picks WHERE outcome = ?", (GRADE_WIN,)
            ).fetchone()["c"]
            slips = conn.execute("SELECT COUNT(*) AS c FROM slips").fetchone()["c"]
            clv_row = conn.execute(
                "SELECT AVG(clv) AS avg_clv, COUNT(clv) AS n FROM picks WHERE clv IS NOT NULL"
            ).fetchone()
        return {
            "totalPicks": total,
            "gradedPicks": graded,
            "pendingPicks": total - graded,
            "gradedHitRate": round(wins / graded, 4) if graded else None,
            "slips": slips,
            "averageClv": round(clv_row["avg_clv"], 4) if clv_row["avg_clv"] is not None else None,
            "clvSampleSize": clv_row["n"],
        }

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------
    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS picks (
                    pick_key TEXT PRIMARY KEY,
                    run_id TEXT,
                    slate_date TEXT,
                    mode TEXT,
                    fixture_slug TEXT,
                    matchup TEXT,
                    row_id TEXT,
                    mlb_person_id INTEGER,
                    player TEXT,
                    team TEXT,
                    market_key TEXT,
                    side TEXT,
                    line REAL,
                    odds REAL,
                    implied_probability REAL,
                    fair_probability REAL,
                    estimated_probability REAL,
                    edge REAL,
                    edge_status TEXT,
                    score REAL,
                    reliability_band TEXT,
                    recorded_at TEXT NOT NULL,
                    graded_at TEXT,
                    outcome TEXT NOT NULL DEFAULT 'pending',
                    actual_value REAL,
                    closing_odds REAL,
                    clv REAL
                );
                CREATE INDEX IF NOT EXISTS idx_picks_outcome ON picks(outcome);
                CREATE INDEX IF NOT EXISTS idx_picks_market ON picks(market_key);
                CREATE INDEX IF NOT EXISTS idx_picks_date ON picks(slate_date);

                CREATE TABLE IF NOT EXISTS slips (
                    slip_id TEXT PRIMARY KEY,
                    run_id TEXT,
                    slate_date TEXT,
                    mode TEXT,
                    leg_count INTEGER,
                    raw_product_odds REAL,
                    estimated_win_probability REAL,
                    expected_value REAL,
                    created_at TEXT NOT NULL,
                    graded_at TEXT,
                    result TEXT NOT NULL DEFAULT 'pending'
                );
                CREATE TABLE IF NOT EXISTS slip_legs (
                    slip_id TEXT NOT NULL,
                    leg_index INTEGER NOT NULL,
                    row_id TEXT,
                    pick_key TEXT,
                    PRIMARY KEY (slip_id, leg_index)
                );

                CREATE TABLE IF NOT EXISTS calibrations (
                    market_key TEXT PRIMARY KEY,
                    intercept REAL,
                    slope REAL,
                    samples INTEGER,
                    brier REAL,
                    fitted_at TEXT
                );

                CREATE TABLE IF NOT EXISTS market_policy (
                    market_key TEXT PRIMARY KEY,
                    status TEXT,
                    samples INTEGER,
                    realized_roi REAL,
                    hit_rate REAL,
                    updated_at TEXT
                );

                CREATE TABLE IF NOT EXISTS correlation_estimates (
                    category TEXT PRIMARY KEY,
                    rho REAL,
                    samples INTEGER,
                    updated_at TEXT
                );
                """
            )
            conn.commit()


def _pick_key(row: dict[str, Any], run_id: str) -> str:
    row_id = str(row.get("rowId") or "")
    if row_id:
        return f"{run_id}:{row_id}"
    base = ":".join(
        str(part)
        for part in (
            row.get("fixtureSlug"),
            row.get("player"),
            _market_key(row),
            row.get("side"),
            row.get("line"),
        )
    )
    return f"{run_id}:{base}"


def _market_key(row: dict[str, Any]) -> str | None:
    return row.get("normalizedMarketKey") or row.get("marketKey") or row.get("market")


def _compute_clv(open_odds: Any, closing_odds: Any) -> float | None:
    open_value = _float_or_none(open_odds)
    close_value = _float_or_none(closing_odds)
    if open_value is None or close_value is None or close_value <= 1.0 or open_value <= 1.0:
        return None
    # Positive CLV means the pick was taken at longer (better) decimal odds
    # than the line closed at. Expressed as the fractional edge of the taken
    # price over the closing price.
    return round((open_value / close_value) - 1.0, 4)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _float_or_none(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
