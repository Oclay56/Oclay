"""Pick ledger: the memory that lets OCLAY learn whether it is right.

Every reviewed candidate leg and every assembled slip is recorded here
with its estimated probability, the odds it was seen at, and enough
identity to grade it later against the real MLB box score. The grading
engine (app.grading) settles legs win/loss/push; the calibration engine
(app.calibration) reads graded picks back out to fit the per-market
corrections that the probability engine then applies. Without this table
the scoring constants are unfalsifiable; with it they become measurable
and self-correcting.

Storage is SQLite by default (no external dependency, ships with Python)
and is intentionally append-friendly: a pick is logged at review time,
then updated in place when graded.
"""

from __future__ import annotations

import hashlib
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
        rows = [row for row in (pool.get("rankedCandidates") or []) if isinstance(row, dict)]
        if not date:
            # A capture with no slate date can never be graded -- the grader needs
            # a date to find the game -- so persisting it would only pile up
            # permanent ungradeable "incomplete pick data" clutter. Skip it.
            return {
                "runId": run_id,
                "picksRecorded": 0,
                "candidateCount": len(rows),
                "skipped": "no_slate_date",
            }
        namespace = str(date)
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
        legs = [leg for leg in (slip.get("legs") or []) if isinstance(leg, dict)]
        # A content-based id (when the caller gives none) means logging the same
        # slip twice updates the one row instead of duplicating it.
        slip_id = str(slip.get("slipId") or _content_slip_id(slate_date, legs))
        namespace = str(slate_date) if slate_date else (run_id or slip_id)
        now = _utc_now()
        # Structure / thesis tags (thesis-block engine) for per-structure and
        # per-thesis realized ROI and the thesis kill-switch.
        target_band = slip.get("targetBand") or {}
        thesis_tags = slip.get("thesisTags")
        if not thesis_tags:
            thesis_tags = [leg.get("thesisTag") for leg in legs if leg.get("thesisTag")]
        thesis_tags_json = json.dumps(sorted({str(t) for t in (thesis_tags or []) if t})) if thesis_tags else None
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO slips (
                    slip_id, run_id, slate_date, mode, leg_count, raw_product_odds,
                    estimated_win_probability, expected_value, structure, thesis_tags,
                    target_low, target_high, created_at, graded_at, result
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                ON CONFLICT(slip_id) DO UPDATE SET
                    leg_count = excluded.leg_count,
                    raw_product_odds = excluded.raw_product_odds,
                    estimated_win_probability = excluded.estimated_win_probability,
                    expected_value = excluded.expected_value,
                    structure = excluded.structure,
                    thesis_tags = excluded.thesis_tags,
                    target_low = excluded.target_low,
                    target_high = excluded.target_high
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
                    slip.get("structure"),
                    thesis_tags_json,
                    _float_or_none(target_band.get("min")),
                    _float_or_none(target_band.get("max")),
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
                    INSERT INTO slip_legs (slip_id, leg_index, row_id, pick_key, block_index, thesis_tag)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(slip_id, leg_index) DO UPDATE SET
                        row_id = excluded.row_id, pick_key = excluded.pick_key,
                        block_index = excluded.block_index, thesis_tag = excluded.thesis_tag
                    """,
                    (
                        slip_id,
                        index,
                        leg.get("rowId"),
                        _pick_key(leg, namespace),
                        _int_or_none(leg.get("blockIndex")),
                        leg.get("thesisTag"),
                    ),
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
                graded_at, outcome, actual_value
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)
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

    def record_imported_slips(self, slips: Iterable[Any], *, season: int = 2025) -> dict[str, Any]:
        """Load parsed Stake history (app.bet_history_import) as graded picks.

        Each supported leg whose outcome is known is inserted already settled
        (no later MLB grading needed) so realized hit rates and slip ROI are
        available immediately. Keys are deterministic, so re-importing the same
        export is idempotent rather than duplicating history.
        """
        import hashlib

        from .bet_history_import import slate_date_for
        from .mlb_props import slug_key

        legs_loaded = 0
        slips_loaded = 0
        legs_skipped = 0
        now = _utc_now()
        with self._connect() as conn:
            for slip in slips:
                slip_legs = list(getattr(slip, "legs", []) or [])
                if not slip_legs:
                    continue
                slate_date = slate_date_for(getattr(slip, "date_text", None), season)
                matchup = getattr(slip, "matchup", None)
                # A fixture slug derived from the matchup lets the correlation
                # engine group this slip's legs as one game and measure real
                # same-game co-hit rates from your own SGM history.
                fixture_slug = slug_key(matchup) if matchup else None
                signature = "|".join(
                    sorted(
                        f"{leg.player}:{leg.market_key}:{leg.side}:{leg.line}"
                        for leg in slip_legs
                    )
                )
                slip_id = "import_" + hashlib.sha1(
                    f"{slate_date}:{signature}".encode("utf-8")
                ).hexdigest()[:16]

                leg_keys: list[str] = []
                for leg in slip_legs:
                    if not leg.supported or leg.outcome not in {GRADE_WIN, GRADE_LOSS, GRADE_PUSH}:
                        legs_skipped += 1
                        continue
                    pick_key = (
                        f"import:{slate_date}:{slug_key(leg.player or '')}:"
                        f"{leg.market_key}:{leg.side}:{leg.line}"
                    )
                    cur = conn.execute(
                        """
                        INSERT INTO picks (
                            pick_key, run_id, slate_date, mode, fixture_slug, matchup, row_id,
                            mlb_person_id, player, team, market_key, side, line, odds,
                            implied_probability, fair_probability, estimated_probability, edge,
                            edge_status, score, reliability_band, recorded_at,
                            graded_at, outcome, actual_value
                        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, NULL,
                                  NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
                        ON CONFLICT(pick_key) DO NOTHING
                        """,
                        (
                            pick_key,
                            slip_id,
                            slate_date,
                            "imported_history",
                            fixture_slug,
                            matchup,
                            leg.player,
                            leg.market_key,
                            leg.side,
                            _float_or_none(leg.line),
                            now,
                            now,
                            leg.outcome,
                            _float_or_none(leg.actual),
                        ),
                    )
                    if cur.rowcount > 0:
                        legs_loaded += 1
                    leg_keys.append(pick_key)

                slips_loaded += self._insert_imported_slip(
                    conn,
                    slip_id=slip_id,
                    slate_date=slate_date,
                    odds=_float_or_none(getattr(slip, "odds", None)),
                    parsed_legs=slip_legs,
                    leg_keys=leg_keys,
                    now=now,
                )
            conn.commit()
        return {
            "slipsLoaded": slips_loaded,
            "legsLoaded": legs_loaded,
            "legsSkipped": legs_skipped,
        }

    def _insert_imported_slip(
        self,
        conn: sqlite3.Connection,
        *,
        slip_id: str,
        slate_date: str | None,
        odds: float | None,
        parsed_legs: list[Any],
        leg_keys: list[str],
        now: str,
    ) -> int:
        # Slip result is only trustworthy when every leg settled cleanly to
        # win/loss; a push/void/unknown leg reprices the parlay, so we cannot
        # reconstruct its odds and mark it indeterminate (excluded from ROI).
        outcomes = [leg.outcome for leg in parsed_legs]
        if any(o not in {GRADE_WIN, GRADE_LOSS} for o in outcomes):
            result = "indeterminate"
        elif all(o == GRADE_WIN for o in outcomes):
            result = GRADE_WIN
        else:
            result = GRADE_LOSS
        cur = conn.execute(
            """
            INSERT INTO slips (
                slip_id, run_id, slate_date, mode, leg_count, raw_product_odds,
                estimated_win_probability, expected_value, created_at, graded_at, result
            ) VALUES (?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
            ON CONFLICT(slip_id) DO NOTHING
            """,
            (
                slip_id,
                slate_date,
                "imported_history",
                len(parsed_legs),
                odds,
                now,
                now,
                result,
            ),
        )
        if cur.rowcount <= 0:
            return 0
        for index, pick_key in enumerate(leg_keys):
            conn.execute(
                """
                INSERT INTO slip_legs (slip_id, leg_index, row_id, pick_key)
                VALUES (?, ?, NULL, ?)
                ON CONFLICT(slip_id, leg_index) DO UPDATE SET pick_key = excluded.pick_key
                """,
                (slip_id, index, pick_key),
            )
        return 1

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
        now = _utc_now()
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE picks
                SET outcome = ?, actual_value = ?, graded_at = ?
                WHERE pick_key = ?
                """,
                (outcome, actual_value, now, pick_key),
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

    def players_missing_person_id(self) -> list[str]:
        """Distinct player names on picks that have no MLB id yet.

        Imported history loads without ids (Stake exports omit them); resolving
        them once lets model validation skip a name search per player.
        """
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT player FROM picks
                WHERE mlb_person_id IS NULL AND player IS NOT NULL AND player != ''
                """
            ).fetchall()
        return [str(row["player"]) for row in rows]

    def set_person_id_for_player(self, player: str, person_id: int) -> int:
        """Stamp a resolved MLB id onto every id-less pick for that player."""
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE picks SET mlb_person_id = ?
                WHERE player = ? AND mlb_person_id IS NULL
                """,
                (int(person_id), player),
            )
            conn.commit()
        return cur.rowcount

    def settled_picks(self) -> list[dict[str, Any]]:
        """Every pick settled to win/loss/push, regardless of model scoring.

        Unlike ``graded_picks`` this does not require an estimated probability,
        so imported history (which has no model estimate) is included. This is
        the read path the backtest harness uses.
        """
        with self._connect() as conn:
            return [
                dict(row)
                for row in conn.execute(
                    "SELECT * FROM picks WHERE outcome IN (?, ?, ?)",
                    (GRADE_WIN, GRADE_LOSS, GRADE_PUSH),
                ).fetchall()
            ]

    def decided_slips(self) -> list[dict[str, Any]]:
        """Slips that resolved cleanly to win or loss (for realized ROI)."""
        with self._connect() as conn:
            return [
                dict(row)
                for row in conn.execute(
                    "SELECT * FROM slips WHERE result IN (?, ?)",
                    (GRADE_WIN, GRADE_LOSS),
                ).fetchall()
            ]

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

    def save_thesis_policies(self, policies: dict[str, dict[str, Any]]) -> int:
        now = _utc_now()
        actionable = {
            tag: policy
            for tag, policy in policies.items()
            if policy.get("status") in {"exclude", "downweight", "ok"}
        }
        with self._connect() as conn:
            for thesis_tag, policy in actionable.items():
                conn.execute(
                    """
                    INSERT INTO thesis_policy (
                        thesis_tag, status, samples, realized_roi, win_rate, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(thesis_tag) DO UPDATE SET
                        status = excluded.status,
                        samples = excluded.samples,
                        realized_roi = excluded.realized_roi,
                        win_rate = excluded.win_rate,
                        updated_at = excluded.updated_at
                    """,
                    (
                        thesis_tag,
                        policy.get("status"),
                        _int_or_none(policy.get("samples")),
                        _float_or_none(policy.get("realizedRoi")),
                        _float_or_none(policy.get("winRate")),
                        now,
                    ),
                )
            conn.commit()
        return len(actionable)

    def load_thesis_policies(self) -> dict[str, dict[str, Any]]:
        with self._connect() as conn:
            try:
                rows = conn.execute("SELECT * FROM thesis_policy").fetchall()
            except sqlite3.OperationalError:
                return {}
        return {
            str(row["thesis_tag"]): {
                "status": row["status"],
                "samples": row["samples"],
                "realizedRoi": row["realized_roi"],
                "winRate": row["win_rate"],
            }
            for row in rows
        }

    def slip_leg_pick_keys(self) -> set[str]:
        """Pick keys that belong to a logged slip (an actual bet leg).

        Picks not in this set are whole-board candidate-pool captures recorded
        for unbiased calibration -- tracked, but never bets.
        """
        with self._connect() as conn:
            try:
                rows = conn.execute(
                    "SELECT DISTINCT pick_key FROM slip_legs WHERE pick_key IS NOT NULL"
                ).fetchall()
            except sqlite3.OperationalError:
                return set()
        return {str(row["pick_key"]) for row in rows}

    def decided_slips_with_legs(self) -> list[dict[str, Any]]:
        """Decided slips enriched with their structure and thesis tags.

        The backtest reads this to slice realized slip ROI by structure (e.g.
        ``3-block``) and by thesis tag, and the thesis kill-switch reads it to
        gate losing theses.
        """
        with self._connect() as conn:
            slips = [dict(row) for row in conn.execute(
                "SELECT * FROM slips WHERE result IN (?, ?)", (GRADE_WIN, GRADE_LOSS)
            ).fetchall()]
        for slip in slips:
            raw = slip.get("thesis_tags")
            try:
                slip["thesisTags"] = json.loads(raw) if raw else []
            except (TypeError, ValueError):
                slip["thesisTags"] = []
        return slips

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

    def record_quote_observations(self, observations: list[dict[str, Any]]) -> int:
        now = _utc_now()
        recorded = 0
        with self._connect() as conn:
            for obs in observations:
                scalar = _float_or_none(obs.get("realizedScalar"))
                if scalar is None:
                    continue
                conn.execute(
                    """
                    INSERT INTO quote_observations (
                        product_odds, prior_ratio, real_quote, realized_scalar,
                        correlation_category, recorded_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        _float_or_none(obs.get("productOdds")),
                        _float_or_none(obs.get("priorRepricingRatio")),
                        _float_or_none(obs.get("realQuote")),
                        scalar,
                        obs.get("correlationCategory"),
                        now,
                    ),
                )
                recorded += 1
            conn.commit()
        return recorded

    def load_quote_model(self) -> dict[str, Any]:
        """Robust median repricing scalar over logged quote observations.

        Also buckets the scalar by correlation category: a category whose real
        Stake quotes run systematically *more* generous than the realized-co-hit
        copula expects (scalar > 1) is one Stake under-prices -- a structural
        correlation overlay. ``byCategory`` carries those per-structure medians.
        """
        with self._connect() as conn:
            try:
                rows = conn.execute(
                    "SELECT realized_scalar, correlation_category FROM quote_observations "
                    "WHERE realized_scalar IS NOT NULL"
                ).fetchall()
            except sqlite3.OperationalError:
                return {"scalar": 1.0, "samples": 0, "byCategory": {}}

        def _median(values: list[float]) -> float:
            values = sorted(values)
            k = len(values)
            return values[k // 2] if k % 2 else (values[k // 2 - 1] + values[k // 2]) / 2

        all_scalars: list[float] = []
        by_category: dict[str, list[float]] = {}
        for row in rows:
            s = float(row["realized_scalar"])
            if not (0.1 <= s <= 3.0):
                continue
            all_scalars.append(s)
            category = row["correlation_category"]
            if category:
                by_category.setdefault(str(category), []).append(s)

        if not all_scalars:
            return {"scalar": 1.0, "samples": 0, "byCategory": {}}
        return {
            "scalar": round(_median(all_scalars), 4),
            "samples": len(all_scalars),
            "byCategory": {
                category: {"scalar": round(_median(vals), 4), "samples": len(vals)}
                for category, vals in by_category.items()
            },
        }

    def summary(self) -> dict[str, Any]:
        with self._connect() as conn:
            total = conn.execute("SELECT COUNT(*) AS c FROM picks").fetchone()["c"]
            graded = conn.execute(
                "SELECT COUNT(*) AS c FROM picks WHERE outcome IN (?, ?)",
                (GRADE_WIN, GRADE_LOSS),
            ).fetchone()["c"]
            # Count pending directly: void/push picks are resolved, not pending,
            # so "total - graded" would wrongly inflate the pending count.
            pending = conn.execute(
                "SELECT COUNT(*) AS c FROM picks WHERE outcome = ?", (PENDING,)
            ).fetchone()["c"]
            wins = conn.execute(
                "SELECT COUNT(*) AS c FROM picks WHERE outcome = ?", (GRADE_WIN,)
            ).fetchone()["c"]
            slips = conn.execute("SELECT COUNT(*) AS c FROM slips").fetchone()["c"]
        return {
            "totalPicks": total,
            "gradedPicks": graded,
            "pendingPicks": pending,
            "gradedHitRate": round(wins / graded, 4) if graded else None,
            "slips": slips,
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
                    actual_value REAL
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
                    structure TEXT,
                    thesis_tags TEXT,
                    target_low REAL,
                    target_high REAL,
                    created_at TEXT NOT NULL,
                    graded_at TEXT,
                    result TEXT NOT NULL DEFAULT 'pending'
                );
                CREATE TABLE IF NOT EXISTS slip_legs (
                    slip_id TEXT NOT NULL,
                    leg_index INTEGER NOT NULL,
                    row_id TEXT,
                    pick_key TEXT,
                    block_index INTEGER,
                    thesis_tag TEXT,
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

                CREATE TABLE IF NOT EXISTS quote_observations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_odds REAL,
                    prior_ratio REAL,
                    real_quote REAL,
                    realized_scalar REAL,
                    recorded_at TEXT
                );

                CREATE TABLE IF NOT EXISTS thesis_policy (
                    thesis_tag TEXT PRIMARY KEY,
                    status TEXT,
                    samples INTEGER,
                    realized_roi REAL,
                    win_rate REAL,
                    updated_at TEXT
                );
                """
            )
            self._migrate_columns(conn)
            conn.commit()

    def _migrate_columns(self, conn: sqlite3.Connection) -> None:
        """Add columns introduced after a ledger was first created.

        ``CREATE TABLE IF NOT EXISTS`` never alters an existing table, so older
        ledgers miss the structure/thesis columns. Add them idempotently.
        """
        wanted = {
            "slips": {
                "structure": "TEXT",
                "thesis_tags": "TEXT",
                "target_low": "REAL",
                "target_high": "REAL",
            },
            "slip_legs": {
                "block_index": "INTEGER",
                "thesis_tag": "TEXT",
            },
            "quote_observations": {
                # The block's dominant same-game correlation category, so the
                # repricing scalar (Stake's real quote vs the copula) can be
                # measured per structure -- the correlation-mispricing signal.
                "correlation_category": "TEXT",
            },
        }
        for table, columns in wanted.items():
            existing = {
                str(row["name"])
                for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
            }
            for name, decl in columns.items():
                if name not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")


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


def _content_slip_id(slate_date: str | None, legs: list[dict[str, Any]]) -> str:
    """Deterministic slip id from the slate date + the slip's legs.

    Identical slips logged twice map to the same id, so the second log updates
    the existing row rather than creating a duplicate. Falls back to a random
    id only when there are no legs to hash.
    """
    if not legs:
        return _new_id("slip")
    signature = "|".join(
        sorted(
            f"{leg.get('player')}:{_market_key(leg)}:{leg.get('side')}:{_float_or_none(leg.get('line'))}"
            for leg in legs
        )
    )
    digest = hashlib.sha1(f"{slate_date}:{signature}".encode("utf-8")).hexdigest()[:16]
    return f"slip_{digest}"


def _market_key(row: dict[str, Any]) -> str | None:
    return row.get("normalizedMarketKey") or row.get("marketKey") or row.get("market")


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
