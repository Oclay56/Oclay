"""Local SQLite job bridge between the API and the Chrome helper.

The API and the Stake Chrome helper run as two processes on the same machine.
This is the rendezvous between them: the API writes a job row, the helper
claims it, runs the browser action, and writes the result back -- all through a
local WAL-mode SQLite queue. No cloud service is involved.

The queue is transient: completed/failed/expired rows are pruned on a short
retention window, so the file stays tiny no matter how long OCLAY runs. The
durable learning data lives in the separate pick ledger, not here.
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .sqlite_util import ensure_auto_vacuum_full


STAKE_SGM_BOARD_JOB_TYPE = "stake_ui_sgm_board"
STAKE_SGM_BOARD_BATCH_JOB_TYPE = "stake_ui_sgm_board_batch"
STAKE_SGM_BUILD_SLIP_JOB_TYPE = "stake_ui_sgm_build_slip"
STAKE_MLB_GAMES_JOB_TYPE = "stake_ui_mlb_games"
STAKE_SGM_BUILD_SLIP_BATCH_JOB_TYPE = "stake_ui_sgm_build_slip_batch"
STAKE_UI_STATE_JOB_TYPE = "stake_ui_state"
STAKE_SGM_CLEAR_SELECTIONS_JOB_TYPE = "stake_ui_sgm_clear_selections"
STAKE_REMOVE_SIDEBAR_GROUP_JOB_TYPE = "stake_ui_remove_sidebar_group"
STAKE_CLEAR_SIDEBAR_JOB_TYPE = "stake_ui_clear_sidebar"

# Backward-compatible name used by the first local helper implementation.
STAKE_SGM_JOB_TYPE = STAKE_SGM_BOARD_JOB_TYPE

# How long a finished (completed/failed/expired) job row is kept before it is
# pruned. The queue is a message bus, not a record store, so this stays short.
_DEFAULT_RETENTION_SECONDS = 1800


class LocalUiBridgeError(RuntimeError):
    pass


class LocalUiBridgeDisabled(LocalUiBridgeError):
    pass


class LocalUiBridgeTimeout(LocalUiBridgeError):
    pass


def _default_db_path() -> str:
    env = os.getenv("OCLAY_LOCAL_UI_JOB_DB", "").strip()
    if env:
        return env
    # Anchor to <repo_root>/data so the API and the Stake helper always share the
    # SAME queue file regardless of each process's current working directory. A
    # relative path here is a footgun: started from different cwds, the two
    # processes would silently use different files and never see each other's jobs.
    return str(Path(__file__).resolve().parent.parent / "data" / "local_ui_jobs.sqlite")


class LocalSqliteJobStore:
    """Local SQLite-backed job queue shared by the API and the Stake helper.

    A WAL-mode SQLite file on disk is the rendezvous between the two local
    processes -- no external service is involved.
    """

    def __init__(
        self,
        *,
        db_path: str | os.PathLike[str] | None = None,
        retention_seconds: int | None = None,
    ) -> None:
        self.db_path = str(db_path or _default_db_path())
        self.retention_seconds = (
            retention_seconds
            if retention_seconds is not None
            else int(os.getenv("OCLAY_LOCAL_UI_JOB_RETENTION_SECONDS", _DEFAULT_RETENTION_SECONDS))
        )
        self._initialized = False

    # -- schema / connection -------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        path = Path(self.db_path)
        if path.parent and not path.parent.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _ensure_schema(self) -> None:
        if self._initialized:
            return
        # FULL auto_vacuum so the queue returns freed pages to the OS every time
        # finished rows are pruned, instead of holding its high-water mark.
        ensure_auto_vacuum_full(self.db_path)
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS local_ui_jobs (
                    job_id TEXT PRIMARY KEY,
                    job_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    request_json TEXT,
                    result_json TEXT,
                    error_message TEXT,
                    worker_id TEXT,
                    created_at TEXT NOT NULL,
                    claimed_at TEXT,
                    completed_at TEXT,
                    updated_at TEXT NOT NULL,
                    expires_at TEXT
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_local_ui_jobs_claim "
                "ON local_ui_jobs (job_type, status, created_at)"
            )
        self._initialized = True

    def enabled(self) -> bool:
        """A local store is available whenever its SQLite file can be opened."""
        try:
            self._ensure_schema()
            return True
        except Exception:
            return False

    # -- public async API (matches the previous store) -----------------------

    async def create_job(
        self,
        *,
        job_type: str,
        request: dict[str, Any],
        timeout_seconds: int,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(self._create_job, job_type, request, timeout_seconds)

    async def wait_for_completed_result(
        self,
        job_id: str,
        *,
        timeout_seconds: int,
        poll_interval_seconds: float = 0.5,
    ) -> dict[str, Any]:
        deadline = asyncio.get_running_loop().time() + max(timeout_seconds, 1)
        ever_claimed = False
        while True:
            job = await self.get_job(job_id)
            status = job.get("status")
            if status in {"completed", "failed", "expired"}:
                return job
            if status == "running":
                ever_claimed = True
            if asyncio.get_running_loop().time() >= deadline:
                if not ever_claimed and status == "pending":
                    # The job was never picked up -> the helper isn't running, or
                    # it is polling a different queue file. This is the common
                    # post-setup failure; say so instead of a vague timeout.
                    raise LocalUiBridgeTimeout(
                        "The Stake helper never claimed this job. Start or restart the "
                        "local Stake helper (and make sure it's the current build, not a "
                        "pre-Supabase-removal process). The job queue is at "
                        f"{self.db_path}."
                    )
                raise LocalUiBridgeTimeout(
                    "The Stake helper claimed this job but did not finish within "
                    f"{timeout_seconds}s. The browser action is slow or stuck -- retry "
                    "with fewer games/legs or a higher timeoutSeconds, or check the "
                    "helper window for a scrape error."
                )
            await asyncio.sleep(max(poll_interval_seconds, 0.25))

    async def get_job(self, job_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._get_job, job_id)

    async def find_recent_completed_job(
        self,
        *,
        job_type: str,
        fixture_slug: str = "",
        cache_key: str = "",
        max_age_seconds: int,
        limit: int = 20,
    ) -> dict[str, Any] | None:
        if max_age_seconds <= 0 or not (fixture_slug or cache_key):
            return None
        return await asyncio.to_thread(
            self._find_recent_completed_job,
            job_type,
            fixture_slug,
            cache_key,
            max_age_seconds,
            limit,
        )

    async def claim_next_pending_job(
        self,
        *,
        worker_id: str,
        job_type: str = STAKE_SGM_JOB_TYPE,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._claim_next_pending_job, worker_id, job_type)

    async def complete_job(self, job_id: str, result: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(self._finish_job, job_id, "completed", result, None)

    async def fail_job(self, job_id: str, error_message: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._finish_job, job_id, "failed", None, error_message)

    async def prune(self, *, retention_seconds: int | None = None) -> dict[str, Any]:
        return await asyncio.to_thread(self._prune, retention_seconds)

    def queue_health(self) -> dict[str, Any]:
        """Snapshot of the queue so a dead/idle helper is visible at a glance.

        A growing ``pending`` count with nothing ``running`` and a stale
        ``lastCompletedAt`` means the helper is not claiming jobs.
        """
        self._ensure_schema()
        with self._connect() as conn:
            counts = {
                str(row["status"]): int(row["n"])
                for row in conn.execute(
                    "SELECT status, COUNT(*) AS n FROM local_ui_jobs GROUP BY status"
                ).fetchall()
            }
            oldest_pending = conn.execute(
                "SELECT created_at FROM local_ui_jobs WHERE status='pending' "
                "ORDER BY created_at ASC LIMIT 1"
            ).fetchone()
            last_completed = conn.execute(
                "SELECT completed_at FROM local_ui_jobs WHERE status='completed' "
                "ORDER BY completed_at DESC LIMIT 1"
            ).fetchone()
        oldest_dt = _parse_utc_datetime(oldest_pending["created_at"]) if oldest_pending else None
        oldest_age = (
            (datetime.now(timezone.utc) - oldest_dt).total_seconds() if oldest_dt else None
        )
        return {
            "dbPath": self.db_path,
            "pending": counts.get("pending", 0),
            "running": counts.get("running", 0),
            "completed": counts.get("completed", 0),
            "failed": counts.get("failed", 0),
            "oldestPendingAgeSeconds": round(oldest_age, 1) if oldest_age is not None else None,
            "lastCompletedAt": last_completed["completed_at"] if last_completed else None,
        }

    # -- sync implementations (run in a worker thread) -----------------------

    def _create_job(
        self, job_type: str, request: dict[str, Any], timeout_seconds: int
    ) -> dict[str, Any]:
        self._ensure_schema()
        self._prune()
        job_id = str(uuid.uuid4())
        now = _utc_now()
        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=max(timeout_seconds, 1) + 60)
        ).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO local_ui_jobs (
                    job_id, job_type, status, request_json, result_json,
                    error_message, created_at, updated_at, expires_at
                ) VALUES (?, ?, 'pending', ?, NULL, NULL, ?, ?, ?)
                """,
                (job_id, job_type, _dumps(request), now, now, expires_at),
            )
        return self._get_job(job_id)

    def _get_job(self, job_id: str) -> dict[str, Any]:
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM local_ui_jobs WHERE job_id = ? LIMIT 1", (job_id,)
            ).fetchone()
        if row is None:
            raise LocalUiBridgeError(f"Local UI job was not found: {job_id}")
        return _row_to_job(row)

    def _find_recent_completed_job(
        self,
        job_type: str,
        fixture_slug: str,
        cache_key: str,
        max_age_seconds: int,
        limit: int,
    ) -> dict[str, Any] | None:
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM local_ui_jobs
                WHERE job_type = ? AND status = 'completed'
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (job_type, max(limit, 1)),
            ).fetchall()
        now = datetime.now(timezone.utc)
        for row in rows:
            request = _loads(row["request_json"]) or {}
            if fixture_slug and str(request.get("fixtureSlug") or "") != fixture_slug:
                continue
            if cache_key and str(request.get("cacheKey") or "") != cache_key:
                continue
            updated_at = _parse_utc_datetime(
                row["completed_at"] or row["updated_at"] or row["created_at"]
            )
            if not updated_at:
                continue
            if (now - updated_at).total_seconds() <= max_age_seconds:
                return _row_to_job(row)
        return None

    def _claim_next_pending_job(
        self, worker_id: str, job_type: str
    ) -> dict[str, Any] | None:
        self._ensure_schema()
        now = _utc_now()
        with self._connect() as conn:
            # BEGIN IMMEDIATE takes the write lock up front so two helper
            # processes can never claim the same row.
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute(
                    """
                    SELECT job_id FROM local_ui_jobs
                    WHERE job_type = ? AND status = 'pending'
                    ORDER BY created_at ASC
                    LIMIT 1
                    """,
                    (job_type,),
                ).fetchone()
                if row is None:
                    conn.execute("ROLLBACK")
                    return None
                job_id = row["job_id"]
                conn.execute(
                    """
                    UPDATE local_ui_jobs
                    SET status = 'running', worker_id = ?, claimed_at = ?, updated_at = ?
                    WHERE job_id = ? AND status = 'pending'
                    """,
                    (worker_id, now, now, job_id),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return self._get_job(job_id)

    def _finish_job(
        self,
        job_id: str,
        status: str,
        result: dict[str, Any] | None,
        error_message: str | None,
    ) -> dict[str, Any]:
        self._ensure_schema()
        now = _utc_now()
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE local_ui_jobs
                SET status = ?, result_json = ?, error_message = ?,
                    completed_at = ?, updated_at = ?
                WHERE job_id = ?
                """,
                (status, _dumps(result), error_message, now, now, job_id),
            )
            if cur.rowcount == 0:
                raise LocalUiBridgeError(f"Local UI job was not found: {job_id}")
        return self._get_job(job_id)

    def _prune(self, retention_seconds: int | None = None) -> dict[str, Any]:
        self._ensure_schema()
        retention = self.retention_seconds if retention_seconds is None else retention_seconds
        cutoff = (
            datetime.now(timezone.utc) - timedelta(seconds=max(retention, 0))
        ).isoformat()
        now_iso = _utc_now()
        with self._connect() as conn:
            # Expire stale jobs that were never finished (helper offline, etc.).
            conn.execute(
                """
                UPDATE local_ui_jobs
                SET status = 'expired', updated_at = ?
                WHERE status IN ('pending', 'running')
                  AND expires_at IS NOT NULL AND expires_at < ?
                """,
                (now_iso, now_iso),
            )
            deleted = conn.execute(
                """
                DELETE FROM local_ui_jobs
                WHERE status IN ('completed', 'failed', 'expired')
                  AND updated_at < ?
                """,
                (cutoff,),
            ).rowcount
        return {"prunedJobs": int(deleted or 0)}


def _row_to_job(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    get = row.__getitem__ if isinstance(row, sqlite3.Row) else row.get
    created_at = get("created_at")
    completed_at = get("completed_at")
    if created_at and completed_at:
        created_dt = _parse_utc_datetime(created_at)
        completed_dt = _parse_utc_datetime(completed_at)
        if created_dt and completed_dt and completed_dt < created_dt:
            completed_at = created_at

    return {
        "jobId": get("job_id"),
        "jobType": get("job_type"),
        "status": get("status"),
        "request": _loads(get("request_json")) or {},
        "result": _loads(get("result_json")),
        "error": get("error_message"),
        "workerId": get("worker_id"),
        "createdAt": created_at,
        "claimedAt": get("claimed_at"),
        "completedAt": completed_at,
        "updatedAt": get("updated_at"),
        "expiresAt": get("expires_at"),
    }


def _dumps(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, default=str)


def _loads(value: Any) -> Any:
    if value is None or value == "":
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_utc_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
