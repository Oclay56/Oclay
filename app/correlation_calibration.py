"""Measure same-game leg correlations from graded ledger history.

The copula's correlation loadings start as reasoned priors. Once the ledger
has graded enough co-occurring legs, this module measures how often pairs in
each category actually co-hit and replaces the prior with the phi coefficient
(shrunk toward the prior by sample size, in app.correlation). That sharpens
every slip win-probability and EV number the system produces.
"""

from __future__ import annotations

import math
import os
import time
from typing import Any

from .correlation import leg_pair_category


# A category needs this many graded pairs before its measured value persists.
_MIN_PAIRS_PER_CATEGORY = 40
_CACHE_SECONDS = 600.0
_estimate_cache: dict[str, Any] = {"loadedAt": 0.0, "estimates": {}}


def build_correlation_estimates(*, ledger: Any | None = None, persist: bool = True) -> dict[str, Any]:
    """Measure per-category phi from graded same-game leg pairs."""
    if ledger is None:
        from .pick_ledger import PickLedger

        ledger = PickLedger()

    games = ledger.graded_legs_by_game()
    # counts[category] = [n11, n10, n01, n00]
    counts: dict[str, list[int]] = {}
    for legs in games:
        for i in range(len(legs)):
            for j in range(i + 1, len(legs)):
                category = leg_pair_category(legs[i], legs[j])
                if category == "different_game":
                    continue
                win_i = int(legs[i].get("win") or 0)
                win_j = int(legs[j].get("win") or 0)
                bucket = counts.setdefault(category, [0, 0, 0, 0])
                if win_i and win_j:
                    bucket[0] += 1
                elif win_i and not win_j:
                    bucket[1] += 1
                elif not win_i and win_j:
                    bucket[2] += 1
                else:
                    bucket[3] += 1

    estimates: dict[str, dict[str, Any]] = {}
    for category, (n11, n10, n01, n00) in counts.items():
        total = n11 + n10 + n01 + n00
        if total < _MIN_PAIRS_PER_CATEGORY:
            continue
        phi = _phi(n11, n10, n01, n00)
        if phi is None:
            continue
        estimates[category] = {
            "rho": round(phi, 4),
            "samples": total,
            "coHitPairs": n11,
        }

    if persist and estimates:
        ledger.save_correlation_estimates(estimates)
        invalidate_correlation_cache()
    return {
        "purpose": "correlation_estimates",
        "categoriesMeasured": len(estimates),
        "estimates": estimates,
        "note": (
            "phi is the realized correlation of same-game leg outcomes; it blends "
            "into the copula priors weighted by sample size."
        ),
    }


def get_active_correlation_estimates(*, force_reload: bool = False) -> dict[str, dict[str, Any]]:
    if os.getenv("OCLAY_DISABLE_MEASURED_CORRELATION", "").strip().lower() in {"1", "true", "yes"}:
        return {}
    now = time.monotonic()
    if not force_reload and now - _estimate_cache["loadedAt"] < _CACHE_SECONDS:
        return dict(_estimate_cache["estimates"])
    estimates: dict[str, dict[str, Any]] = {}
    try:
        from .pick_ledger import PickLedger

        estimates = PickLedger().load_correlation_estimates()
    except Exception:
        estimates = {}
    _estimate_cache["loadedAt"] = now
    _estimate_cache["estimates"] = estimates
    return dict(estimates)


def invalidate_correlation_cache() -> None:
    _estimate_cache["loadedAt"] = 0.0
    _estimate_cache["estimates"] = {}


def _phi(n11: int, n10: int, n01: int, n00: int) -> float | None:
    """Phi coefficient: Pearson correlation of two binary outcomes."""
    row1 = n11 + n10
    row0 = n01 + n00
    col1 = n11 + n01
    col0 = n10 + n00
    denominator = row1 * row0 * col1 * col0
    if denominator <= 0:
        return None
    return (n11 * n00 - n10 * n01) / math.sqrt(denominator)
