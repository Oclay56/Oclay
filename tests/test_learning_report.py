from __future__ import annotations

from rich.console import Console

from app.learning_report import print_honesty_report, print_profitability_report


def _capture(fn, report) -> str:
    console = Console(record=True, width=100)
    fn(report, console=console)
    return console.export_text()


def test_profitability_report_renders_sections():
    report = {
        "sampleSize": {"settledPicks": 605, "decidedSlips": 140},
        "legPerformance": {
            "gradedLegs": 605,
            "overallHitRate": 0.76,
            "byMarket": [
                {"market": "home_runs:under", "legs": 168, "wins": 151, "hitRate": 0.8988, "sufficientSample": True},
                {"market": "hits:under", "legs": 24, "wins": 11, "hitRate": 0.4583, "sufficientSample": True},
            ],
            "coldMarkets": [{"market": "hits:under", "legs": 24, "wins": 11, "hitRate": 0.4583}],
        },
        "slipPerformance": {
            "decidedSlips": 140,
            "pricedSlips": 138,
            "winRate": 0.3357,
            "roi": 0.3081,
            "byLegCount": [{"legCount": 3, "slips": 10, "winRate": 0.5, "roi": 1.545}],
        },
    }
    text = _capture(print_profitability_report, report)
    assert "PROFITABLE" in text
    assert "home_runs:under" in text
    assert "Cold markets" in text
    assert "ROI by parlay size" in text


def test_honesty_report_renders_verdict_and_curve():
    report = {
        "consideredPicks": 605,
        "scoredPicks": 336,
        "status": "ok",
        "brierScore": 0.1878,
        "meanPredicted": 0.7281,
        "actualHitRate": 0.7232,
        "calibrationError": 0.0049,
        "coverageGaps": {"insufficientPriorGames": 269, "unresolvedPlayer": 0, "unmappableMarket": 0},
        "reliabilityCurve": [
            {"bucket": "0.7-0.8", "picks": 120, "meanPredicted": 0.74, "actualHitRate": 0.73},
        ],
    }
    text = _capture(print_honesty_report, report)
    assert "HONEST" in text
    assert "Excellent" in text  # calibration error <= 2%
    assert "Reliability curve" in text


def test_honesty_report_handles_empty_history():
    report = {"consideredPicks": 0, "scoredPicks": 0, "status": "no_scoreable_history"}
    text = _capture(print_honesty_report, report)
    assert "Not enough scoreable history" in text
