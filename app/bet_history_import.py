"""Import pasted Stake 'My Bets' history into the pick ledger.

Stake's My Bets export pastes as plain text: each slip shows its leg count,
total odds, matchup, date, and then every leg as

    Under 1.5 Batter Strikeouts
    <Player Name>
    <actual result>
    [<line threshold>]

The actual result sits right beside each leg, so every standard player-prop
leg can be graded directly — no MLB refetch, no manual entry. This parser
turns that text into graded picks and loads them into the ledger, which
instantly bootstraps realized hit rates per market, the market kill-switch,
and co-occurrence correlations from your real betting history.

Exotic markets (first-run/first-RBI/first-home-run, win probability, team and
match markets) are not part of the player-prop model, so they are parsed but
flagged unsupported and skipped from grading.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .mlb_props import slug_key


# Display market name (lowercased) -> internal model key. Only player props the
# model actually scores are graded; everything else is skipped.
SUPPORTED_MARKETS: dict[str, str] = {
    "hits": "hits",
    "singles": "singles",
    "total bases": "total_bases",
    "runs": "runs",
    "rbis": "rbi",
    "rbi": "rbi",
    "hits + runs + rbis": "hits_runs_rbis",
    "batter strikeouts": "batter_strikeouts",
    "batter walks": "batter_walks",
    "home runs": "home_runs",
    "stolen bases": "stolen_bases",
    "strikeouts": "strikeouts",
    "walks": "walks_allowed",
    "hits allowed": "hits_allowed",
    "earned runs": "earned_runs",
    "outs": "outs_recorded",
}

_SLIP_HEADER = re.compile(r"^\d+\s+leg\s+(same game multi|multi)$", re.IGNORECASE)
_LEG_HEADER = re.compile(r"^(under|over)\s+(\d+(?:\.\d+)?)\s*(.*)$", re.IGNORECASE)
_MATCHUP = re.compile(r"^(.+?)\s+-\s+(.+)$")
_DECIMAL = re.compile(r"^\d{1,3}(?:,\d{3})*(?:\.\d+)?$")
_INT = re.compile(r"^-?\d+$")
_DATE = re.compile(r"^[A-Z][a-z]{2},\s+[A-Z][a-z]{2}\s+\d{1,2}", re.IGNORECASE)


@dataclass
class ParsedLeg:
    player: str | None
    market_display: str
    market_key: str | None
    side: str
    line: float
    actual: float | None
    outcome: str  # win | loss | push | void | unknown
    supported: bool


@dataclass
class ParsedSlip:
    leg_count: int | None = None
    odds: float | None = None
    matchup: str | None = None
    date_text: str | None = None
    legs: list[ParsedLeg] = field(default_factory=list)


def parse_bet_history(text: str) -> list[ParsedSlip]:
    """Parse one pasted My Bets blob into structured slips and graded legs."""
    lines = [line.strip() for line in str(text or "").splitlines()]
    slips: list[ParsedSlip] = []
    current = ParsedSlip()
    have_current = False
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]
        if not line:
            i += 1
            continue

        slip_match = _SLIP_HEADER.match(line)
        if slip_match:
            if have_current and current.legs:
                slips.append(current)
            current = ParsedSlip(leg_count=_leading_int(line))
            have_current = True
            i += 1
            # The next decimal is the slip odds; the next "A - B" is the matchup.
            i = _consume_slip_header(lines, i, current)
            continue

        leg_match = _LEG_HEADER.match(line)
        if leg_match:
            if not have_current:
                current = ParsedSlip()
                have_current = True
            leg, i = _parse_leg(lines, i, leg_match)
            if leg is not None:
                current.legs.append(leg)
            continue

        # Matchup / date lines outside a fresh slip header (cross-game multis).
        matchup = _MATCHUP.match(line)
        if matchup and have_current and current.matchup is None and not _DATE.match(line):
            current.matchup = line
        i += 1

    if have_current and current.legs:
        slips.append(current)
    return slips


def _consume_slip_header(lines: list[str], i: int, slip: ParsedSlip) -> int:
    """Read the odds, matchup, and date that follow a slip-count header."""
    seen = 0
    while i < len(lines) and seen < 8:
        line = lines[i]
        if not line:
            i += 1
            continue
        if _LEG_HEADER.match(line) or _SLIP_HEADER.match(line):
            break
        if slip.odds is None and _DECIMAL.match(line) and "." in line:
            slip.odds = _to_float(line)
        elif slip.matchup is None and _MATCHUP.match(line) and not _DATE.match(line):
            slip.matchup = line
        elif slip.date_text is None and _DATE.match(line):
            slip.date_text = line
        i += 1
        seen += 1
    return i


def _parse_leg(lines: list[str], i: int, leg_match: re.Match[str]) -> tuple[ParsedLeg | None, int]:
    side = leg_match.group(1).lower()
    line_value = _to_float(leg_match.group(2))
    market_display = (leg_match.group(3) or "").strip()
    i += 1

    # Market name can spill onto the next line (e.g. "Under 0.5" / "Match Triples").
    if not market_display:
        while i < len(lines) and not lines[i]:
            i += 1
        if i < len(lines) and not _is_boundary(lines[i]):
            market_display = lines[i].strip()
            i += 1

    market_key = _market_key(market_display)
    player: str | None = None
    actual: float | None = None
    void = False

    # The player is the next text line; then the first integer is the actual.
    while i < len(lines):
        line = lines[i]
        if _is_boundary(line):
            break
        if not line:
            i += 1
            continue
        if line.lower() == "void":
            void = True
            i += 1
            continue
        if _INT.match(line):
            if actual is None:
                actual = _to_float(line)
            i += 1
            continue
        if _DECIMAL.match(line) or _DATE.match(line) or _MATCHUP.match(line):
            # Odds / date / next matchup -> end of this leg's block.
            break
        if player is None:
            player = line
            i += 1
            continue
        break

    if line_value is None:
        return None, i
    outcome = _grade(side, line_value, actual, void)
    return (
        ParsedLeg(
            player=player,
            market_display=market_display,
            market_key=market_key,
            side=side,
            line=line_value,
            actual=actual,
            outcome=outcome,
            supported=market_key is not None and player is not None,
        ),
        i,
    )


def _grade(side: str, line: float, actual: float | None, void: bool) -> str:
    if void:
        return "void"
    if actual is None:
        return "unknown"
    if abs(actual - line) < 1e-9:
        return "push"
    cleared = actual > line
    if side == "over":
        return "win" if cleared else "loss"
    return "loss" if cleared else "win"


def _market_key(display: str) -> str | None:
    key = display.strip().lower()
    if key in SUPPORTED_MARKETS:
        return SUPPORTED_MARKETS[key]
    # Anything first-*, win probability, team/match markets are not player props.
    return None


def _is_boundary(line: str) -> bool:
    return bool(_LEG_HEADER.match(line) or _SLIP_HEADER.match(line))


def _leading_int(line: str) -> int | None:
    match = re.match(r"^(\d+)", line)
    return int(match.group(1)) if match else None


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def summarize(slips: list[ParsedSlip]) -> dict[str, Any]:
    """Realized hit rates per market/side/line from the parsed graded legs."""
    graded = [
        leg
        for slip in slips
        for leg in slip.legs
        if leg.supported and leg.outcome in {"win", "loss"}
    ]
    by_market: dict[str, dict[str, int]] = {}
    for leg in graded:
        bucket = by_market.setdefault(
            f"{leg.side} {leg.line} {leg.market_key}", {"win": 0, "loss": 0}
        )
        bucket[leg.outcome] += 1

    market_rates = {}
    for key, counts in sorted(by_market.items()):
        total = counts["win"] + counts["loss"]
        market_rates[key] = {
            "legs": total,
            "hitRate": round(counts["win"] / total, 4) if total else None,
        }

    total_supported = sum(1 for s in slips for leg in s.legs if leg.supported)
    total_legs = sum(len(s.legs) for s in slips)
    return {
        "slips": len(slips),
        "totalLegs": total_legs,
        "supportedLegs": total_supported,
        "gradedLegs": len(graded),
        "unsupportedLegs": total_legs - total_supported,
        "marketHitRates": market_rates,
    }
