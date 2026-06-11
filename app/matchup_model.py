"""Matchup-aware sharpening of the per-game mean.

The probability engine turns a player's per-game rate into a line-clearing
probability. The quality of that probability is capped by the quality of the
mean it is handed. This module sharpens that mean with the signals that
actually move MLB props before the distribution sees it:

- Handedness platoon: a batter's split vs the opposing pitcher's hand,
  measured against their own two-way baseline. Books price the season line;
  the platoon edge is where a specific line is wrong.
- Log5 strikeout interaction: batter K% and the opposing pitcher's K%
  combined through the Bill James log5 formula (the standard rate-vs-rate
  interaction), and pitcher K props scaled by how K-prone the opposing
  lineup is. K markets are the most modelable in baseball; crude threshold
  nudges leave that on the table.
- Park factors: a static directional table that inflates or suppresses
  power/contact means by venue. Cheap, and it matters most in the tails
  where longshots live.

Every adjustment is reported so the edge is auditable, never a black box.
"""

from __future__ import annotations

from typing import Any


# Markets whose per-game volume responds to platoon and park.
HITTING_VOLUME_MARKETS = {
    "hits",
    "total_bases",
    "singles",
    "runs",
    "rbi",
    "home_runs",
    "hits_runs_rbis",
}

# Modern MLB league-average batter strikeout rate per plate appearance.
LEAGUE_BATTER_K_RATE = 0.222
DEFAULT_BATTER_PA_PER_GAME = 4.1

HANDEDNESS_BOUND = (0.85, 1.18)
HANDEDNESS_MIN_SPLIT_GAMES = 15
PITCHER_K_LEAN_BOUND = (0.82, 1.20)

# Directional venue multipliers on the per-game mean. Keys are distinctive
# lowercase substrings of the MLB venue name; values map market -> factor.
# 1.0 is neutral, so only non-neutral markets are listed.
PARK_FACTORS: dict[str, dict[str, float]] = {
    "coors field": {"hits": 1.08, "total_bases": 1.12, "home_runs": 1.16, "runs": 1.14, "rbi": 1.10},
    "great american": {"home_runs": 1.18, "total_bases": 1.07, "runs": 1.05},
    "yankee stadium": {"home_runs": 1.12, "total_bases": 1.04},
    "fenway park": {"hits": 1.06, "total_bases": 1.06, "runs": 1.05},
    "citizens bank": {"home_runs": 1.10, "total_bases": 1.05},
    "globe life": {"home_runs": 1.07, "total_bases": 1.04},
    "chase field": {"hits": 1.05, "total_bases": 1.05},
    "american family": {"home_runs": 1.08},
    "rogers centre": {"home_runs": 1.07, "total_bases": 1.04},
    "daikin park": {"home_runs": 1.07},
    "minute maid": {"home_runs": 1.07},
    "rate field": {"home_runs": 1.08},
    "guaranteed rate": {"home_runs": 1.08},
    "wrigley field": {"home_runs": 1.04},
    "dodger stadium": {"home_runs": 1.06},
    "oracle park": {"home_runs": 0.82, "total_bases": 0.94, "hits": 0.97},
    "petco park": {"home_runs": 0.90, "total_bases": 0.96},
    "t-mobile park": {"home_runs": 0.91, "hits": 0.95, "total_bases": 0.95},
    "oakland coliseum": {"home_runs": 0.88, "hits": 0.94, "total_bases": 0.92},
    "loandepot park": {"home_runs": 0.90, "total_bases": 0.95},
    "comerica park": {"home_runs": 0.91, "total_bases": 0.96},
    "kauffman stadium": {"home_runs": 0.90, "hits": 1.03},
    "pnc park": {"home_runs": 0.92},
    "citi field": {"home_runs": 0.94},
    "busch stadium": {"home_runs": 0.93, "total_bases": 0.97},
    "tropicana field": {"home_runs": 0.95},
}


def sharpen_mean(
    season_mean: float | None,
    *,
    market_key: Any,
    candidate: dict[str, Any],
) -> dict[str, Any] | None:
    """Return the matchup-adjusted per-game mean plus an audit trail."""
    base = _float_or_none(season_mean)
    if base is None or base < 0:
        return None
    market = _norm_market(market_key)
    mean = base
    adjustments: list[dict[str, Any]] = []

    platoon = _handedness_factor(market, candidate)
    if platoon is not None:
        mean *= platoon["factor"]
        adjustments.append(platoon)

    park = _park_factor(market, candidate)
    if park is not None:
        mean *= park["factor"]
        adjustments.append(park)

    log5 = _log5_batter_strikeouts(market, candidate)
    if log5 is not None:
        mean = log5["mean"]
        adjustments.append(log5)

    pitcher_k = _pitcher_strikeout_lean(market, candidate, current_mean=mean)
    if pitcher_k is not None:
        mean = pitcher_k["mean"]
        adjustments.append(pitcher_k)

    if not adjustments:
        return None
    return {
        "mean": round(max(0.0, mean), 4),
        "baseMean": round(base, 4),
        "adjustments": adjustments,
    }


def log5_rate(rate_a: float, rate_b: float, league_rate: float) -> float:
    """Bill James log5: probability of the event given two independent rates."""
    a = _clamp_rate(rate_a)
    b = _clamp_rate(rate_b)
    league = _clamp_rate(league_rate)
    numerator = (a * b) / league
    denominator = numerator + ((1 - a) * (1 - b)) / (1 - league)
    if denominator <= 0:
        return a
    return max(0.0, min(1.0, numerator / denominator))


def _handedness_factor(market: str, candidate: dict[str, Any]) -> dict[str, Any] | None:
    if market not in HITTING_VOLUME_MARKETS:
        return None
    hand = _opponent_pitcher_hand(candidate)
    if hand not in {"L", "R"}:
        return None
    splits = ((candidate.get("playerSplits") or {}).get("seasonSplits")) or []
    vr = _split_for_code(splits, "vr")
    vl = _split_for_code(splits, "vl")
    vs_hand = vr if hand == "R" else vl
    if vs_hand is None or not _split_has_sample(vs_hand):
        return None
    metric_hand = _split_ops(vs_hand)
    metric_vr = _split_ops(vr)
    metric_vl = _split_ops(vl)
    baseline_parts = [m for m in (metric_vr, metric_vl) if m]
    if metric_hand is None or not baseline_parts:
        return None
    baseline = sum(baseline_parts) / len(baseline_parts)
    if baseline <= 0:
        return None
    raw = metric_hand / baseline
    factor = max(HANDEDNESS_BOUND[0], min(HANDEDNESS_BOUND[1], raw))
    return {
        "source": "handedness_platoon",
        "opponentHand": hand,
        "metric": "ops",
        "splitOps": round(metric_hand, 4),
        "baselineOps": round(baseline, 4),
        "rawRatio": round(raw, 4),
        "factor": round(factor, 4),
    }


def _park_factor(market: str, candidate: dict[str, Any]) -> dict[str, Any] | None:
    venue = ((candidate.get("gameContext") or {}).get("venue") or {}).get("name")
    if not venue:
        return None
    key = str(venue).strip().lower()
    for substring, table in PARK_FACTORS.items():
        if substring in key:
            factor = table.get(market)
            if factor is None:
                return None
            return {
                "source": "park_factor",
                "venue": venue,
                "market": market,
                "factor": round(float(factor), 4),
            }
    return None


def _log5_batter_strikeouts(market: str, candidate: dict[str, Any]) -> dict[str, Any] | None:
    if market != "batter_strikeouts":
        return None
    batter_rate = _batter_k_rate(candidate)
    pitcher_rate = _pitcher_k_rate_per_bf(candidate.get("opponentPitcherContext"))
    if batter_rate is None or pitcher_rate is None:
        return None
    combined = log5_rate(batter_rate, pitcher_rate, LEAGUE_BATTER_K_RATE)
    pa_per_game = _batter_pa_per_game(candidate) or DEFAULT_BATTER_PA_PER_GAME
    mean = combined * pa_per_game
    return {
        "source": "log5_batter_strikeouts",
        "batterKRatePerPA": round(batter_rate, 4),
        "pitcherKRatePerBF": round(pitcher_rate, 4),
        "leagueKRate": LEAGUE_BATTER_K_RATE,
        "combinedKRatePerPA": round(combined, 4),
        "paPerGame": round(pa_per_game, 3),
        "mean": round(mean, 4),
    }


def _pitcher_strikeout_lean(
    market: str,
    candidate: dict[str, Any],
    *,
    current_mean: float,
) -> dict[str, Any] | None:
    if market not in {"strikeouts", "pitcher_strikeouts"}:
        return None
    team_context = candidate.get("opponentTeamContext") or {}
    if team_context.get("status") != "available":
        return None
    lineup_k_rate = _float_or_none((team_context.get("seasonHitting") or {}).get("strikeoutRate"))
    if lineup_k_rate is None or lineup_k_rate <= 0:
        return None
    raw = lineup_k_rate / LEAGUE_BATTER_K_RATE
    factor = max(PITCHER_K_LEAN_BOUND[0], min(PITCHER_K_LEAN_BOUND[1], raw))
    return {
        "source": "opponent_lineup_k_lean",
        "lineupKRate": round(lineup_k_rate, 4),
        "leagueKRate": LEAGUE_BATTER_K_RATE,
        "rawRatio": round(raw, 4),
        "factor": round(factor, 4),
        "mean": round(current_mean * factor, 4),
    }


def _opponent_pitcher_hand(candidate: dict[str, Any]) -> str | None:
    pitcher = (candidate.get("opponentPitcherContext") or {}).get("pitcher") or {}
    hand = pitcher.get("pitchHand")
    if not hand:
        hand = (candidate.get("lineupContext") or {}).get("opponentPitcherHand")
    if isinstance(hand, str) and hand[:1].upper() in {"L", "R"}:
        return hand[:1].upper()
    return None


def _split_for_code(splits: list[dict[str, Any]], code: str) -> dict[str, Any] | None:
    for row in splits:
        split = row.get("split")
        if isinstance(split, dict) and str(split.get("code") or "").lower() == code:
            return row
        if isinstance(split, str) and split.lower() == code:
            return row
    return None


def _split_has_sample(split: dict[str, Any]) -> bool:
    games = _float_or_none((split.get("stats") or {}).get("gamesPlayed"))
    return games is not None and games >= HANDEDNESS_MIN_SPLIT_GAMES


def _split_ops(split: dict[str, Any] | None) -> float | None:
    if not split:
        return None
    stats = split.get("stats") or {}
    ops = _float_or_none(stats.get("ops"))
    if ops is not None:
        return ops
    obp = _float_or_none(stats.get("obp"))
    slg = _float_or_none(stats.get("slg"))
    if obp is not None and slg is not None:
        return obp + slg
    return None


def _batter_k_rate(candidate: dict[str, Any]) -> float | None:
    season = candidate.get("season") or {}
    total_k = _float_or_none(season.get("total"))
    pa = _float_or_none((candidate.get("seasonSample") or {}).get("plateAppearances"))
    if total_k is None or pa is None or pa <= 0:
        return None
    return _clamp_rate(total_k / pa)


def _batter_pa_per_game(candidate: dict[str, Any]) -> float | None:
    sample = candidate.get("seasonSample") or {}
    pa = _float_or_none(sample.get("plateAppearances"))
    games = _float_or_none(sample.get("games"))
    if pa is None or games is None or games <= 0:
        return None
    return max(2.5, min(5.2, pa / games))


def _pitcher_k_rate_per_bf(pitcher_context: dict[str, Any] | None) -> float | None:
    pitcher_context = pitcher_context or {}
    if pitcher_context.get("status") != "available":
        return None
    season = pitcher_context.get("season") or {}
    strikeouts = _float_or_none(season.get("strikeOuts"))
    innings = _innings_to_float(season.get("inningsPitched"))
    hits = _float_or_none(season.get("hitsAllowed")) or 0.0
    walks = _float_or_none(season.get("walksAllowed")) or 0.0
    if strikeouts is None or innings is None or innings <= 0:
        return None
    batters_faced = innings * 3 + hits + walks
    if batters_faced <= 0:
        return None
    return _clamp_rate(strikeouts / batters_faced)


def _innings_to_float(value: Any) -> float | None:
    raw = _float_or_none(value)
    if raw is None:
        return None
    whole = int(raw)
    fraction = round(raw - whole, 1)
    # MLB encodes thirds of an inning as .1 and .2.
    if fraction == 0.1:
        return whole + 1 / 3
    if fraction == 0.2:
        return whole + 2 / 3
    return raw


def _norm_market(market_key: Any) -> str:
    return str(market_key or "").strip().lower().replace("-", "_")


def _clamp_rate(value: float) -> float:
    return max(0.001, min(0.999, float(value)))


def _float_or_none(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
