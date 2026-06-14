"""Command-line entry point for OCLAY's nightly learning loop.

Run after a slate finishes to settle picks against final box scores and
refit the per-market calibration that the probability engine consumes:

    python -m app.learning_cli grade --date 2026-05-08
    python -m app.learning_cli calibrate
    python -m app.learning_cli loop --date 2026-05-08   # grade then calibrate
    python -m app.learning_cli summary
    python -m app.learning_cli backtest                 # realized performance

Intended to be scheduled (cron / Task Scheduler / Render cron) once a day.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from .backtest import run_backtest
from .backtest_model import run_model_backtest
from .calibration import build_calibration_report
from .correlation_calibration import build_correlation_estimates
from .player_backfill import backfill_person_ids
from .grading import diagnose_pending_picks, grade_pending_picks
from .mlb_data import MLBDataEngine, MLBStatsClient, build_mlb_http_client
from .pick_ledger import PickLedger
from .probability_engine import invalidate_calibration_cache
from .timing import build_timing_plan, games_from_mlb_schedule


async def _grade(slate_date: str | None) -> dict[str, Any]:
    ledger = PickLedger()
    async with build_mlb_http_client() as http_client:
        engine = MLBDataEngine(MLBStatsClient(http_client))
        return await grade_pending_picks(engine, ledger=ledger, slate_date=slate_date)


async def _model_backtest(min_prior_games: int) -> dict[str, Any]:
    ledger = PickLedger()
    async with build_mlb_http_client() as http_client:
        engine = MLBDataEngine(MLBStatsClient(http_client))
        report = await run_model_backtest(engine, ledger=ledger, min_prior_games=min_prior_games)
        # Read-only: show which logged picks are still missing from calibration.
        pending = await diagnose_pending_picks(engine, ledger=ledger)
        report["waitingOn"] = pending["waitingOn"]
        report["needsAttention"] = pending["needsAttention"]
        return report


async def _backfill_ids() -> dict[str, Any]:
    ledger = PickLedger()
    async with build_mlb_http_client() as http_client:
        engine = MLBDataEngine(MLBStatsClient(http_client))
        return await backfill_person_ids(engine, ledger=ledger)


async def _timing(slate_date: str | None) -> dict[str, Any]:
    from datetime import date

    target = slate_date or date.today().isoformat()
    async with build_mlb_http_client() as http_client:
        engine = MLBDataEngine(MLBStatsClient(http_client))
        schedule = await engine.get_schedule(target)
    return build_timing_plan(games_from_mlb_schedule(schedule))


def _calibrate() -> dict[str, Any]:
    report = build_calibration_report(persist=True)
    correlations = build_correlation_estimates(persist=True)
    invalidate_calibration_cache()
    quote_model = PickLedger().load_quote_model()
    return {
        "gradedSamples": report["gradedSamples"],
        "marketsCorrected": len(report["corrections"]),
        "killedMarkets": report.get("killedMarkets") or [],
        "correlationCategoriesMeasured": correlations["categoriesMeasured"],
        "correlationMispricing": {
            "globalScalar": quote_model.get("scalar"),
            "samples": quote_model.get("samples"),
            "byCategory": quote_model.get("byCategory") or {},
        },
        "overall": report["overall"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="oclay-learning", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    grade_cmd = sub.add_parser("grade", help="Settle pending picks against MLB box scores.")
    grade_cmd.add_argument("--date", default=None, help="Slate date YYYY-MM-DD (default: all pending).")

    sub.add_parser("calibrate", help="Refit calibration, market policy, and correlations.")
    sub.add_parser("summary", help="Print ledger accountability metrics.")
    backtest_cmd = sub.add_parser(
        "backtest", help="Replay settled history into a realized-performance report."
    )
    backtest_cmd.add_argument(
        "--pretty", action="store_true", help="Render a formatted report instead of JSON."
    )
    model_cmd = sub.add_parser(
        "model-backtest",
        help="Re-score settled picks point-in-time and grade model calibration (uses MLB API).",
    )
    model_cmd.add_argument(
        "--min-prior-games",
        type=int,
        default=3,
        help="Minimum pre-slate games required to score a pick (default: 3).",
    )
    model_cmd.add_argument(
        "--pretty", action="store_true", help="Render a formatted report instead of JSON."
    )
    sub.add_parser(
        "backfill-ids",
        help="Resolve MLB ids for id-less picks (imported history) so validation is fast.",
    )

    timing_cmd = sub.add_parser("timing", help="Print games due for snapshot/lineup rescan.")
    timing_cmd.add_argument("--date", default=None, help="Slate date YYYY-MM-DD.")

    loop_cmd = sub.add_parser("loop", help="Grade then calibrate in one pass.")
    loop_cmd.add_argument("--date", default=None, help="Slate date YYYY-MM-DD.")
    loop_cmd.add_argument(
        "--pretty", action="store_true", help="Render a formatted report instead of JSON."
    )

    sharp_cmd = sub.add_parser(
        "sharp-refresh", help="Pull sharp lines from The Odds API for line-shopping (Avenue 2)."
    )
    sharp_cmd.add_argument(
        "--max-events", type=int, default=None, help="Cap games fetched (saves Odds API credits)."
    )

    args = parser.parse_args(argv)

    if args.command == "grade":
        result = asyncio.run(_grade(args.date))
    elif args.command == "calibrate":
        result = _calibrate()
    elif args.command == "summary":
        result = PickLedger().summary()
    elif args.command == "backtest":
        if getattr(args, "pretty", False):
            print("Running ROI (realized backtest)...\n", flush=True)
            from .learning_report import print_profitability_report

            print_profitability_report(run_backtest())
            return 0
        result = run_backtest()
    elif args.command == "model-backtest":
        if getattr(args, "pretty", False):
            print(
                "Running Honest (point-in-time model validation)... fetching MLB game logs, ~30s\n",
                flush=True,
            )
            from .learning_report import print_honesty_report

            print_honesty_report(asyncio.run(_model_backtest(args.min_prior_games)))
            return 0
        result = asyncio.run(_model_backtest(args.min_prior_games))
    elif args.command == "backfill-ids":
        result = asyncio.run(_backfill_ids())
    elif args.command == "sharp-refresh":
        from .odds_api import refresh_sharp_lines

        result = asyncio.run(refresh_sharp_lines(max_events=args.max_events))
    elif args.command == "timing":
        result = asyncio.run(_timing(args.date))
    elif args.command == "loop":
        if getattr(args, "pretty", False):
            print("Running Trainer (grade + recalibrate)...\n", flush=True)
        graded = asyncio.run(_grade(args.date))
        calibrated = _calibrate()
        result = {"grade": graded, "calibrate": calibrated}
        if getattr(args, "pretty", False):
            from .learning_report import print_trainer_report

            print_trainer_report(result)
            return 0
    else:  # pragma: no cover - argparse enforces a valid command
        parser.error(f"unknown command {args.command}")
        return 2

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
