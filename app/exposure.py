"""Slate-level exposure / portfolio management.

Slips are built one game at a time, so across a full night you can quietly
pile risk onto one player, one team, or a cluster of correlated outcomes —
which inflates variance and the chance of a single event sinking several
slips at once. This layer looks at the *whole set* of slips you'd place,
reports the concentration, and can prune it to a diversified portfolio that
caps exposure per player/team/game while keeping the highest expected value.

It is the natural partner to stake sizing: decide which bets, in what mix,
before deciding how much.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from .mlb_props import slug_key


DEFAULT_MAX_SLIPS_PER_PLAYER = 2
DEFAULT_MAX_SLIPS_PER_GAME = 3
DEFAULT_MAX_SLIPS_PER_TEAM = 4


def slate_exposure_report(slips: list[dict[str, Any]]) -> dict[str, Any]:
    """Concentration of a proposed set of slips across players/teams/games."""
    player_slips: dict[str, set[int]] = defaultdict(set)
    team_slips: dict[str, set[int]] = defaultdict(set)
    game_slips: dict[str, set[int]] = defaultdict(set)
    player_legs: dict[str, int] = defaultdict(int)

    for index, slip in enumerate(slips):
        for leg in slip.get("legs") or []:
            player = _player(leg)
            team = _team(leg)
            game = _fixture(leg)
            if player:
                player_slips[player].add(index)
                player_legs[player] += 1
            if team:
                team_slips[team].add(index)
            if game:
                game_slips[game].add(index)

    def _top(mapping: dict[str, set[int]], limit: int = 8) -> list[dict[str, Any]]:
        rows = [{"key": key, "slips": len(idxs)} for key, idxs in mapping.items()]
        rows.sort(key=lambda r: r["slips"], reverse=True)
        return rows[:limit]

    flags: list[str] = []
    if any(len(idxs) > DEFAULT_MAX_SLIPS_PER_PLAYER for idxs in player_slips.values()):
        flags.append("player_over_exposed")
    if any(len(idxs) > DEFAULT_MAX_SLIPS_PER_GAME for idxs in game_slips.values()):
        flags.append("game_over_exposed")
    if any(len(idxs) > DEFAULT_MAX_SLIPS_PER_TEAM for idxs in team_slips.values()):
        flags.append("team_over_exposed")

    return {
        "slipCount": len(slips),
        "distinctPlayers": len(player_slips),
        "distinctGames": len(game_slips),
        "topPlayerExposure": _top(player_slips),
        "topGameExposure": _top(game_slips),
        "topTeamExposure": _top(team_slips),
        "concentrationFlags": flags,
        "note": (
            "Counts how many slips each player/team/game appears in. Over-exposure "
            "means one event can sink several slips at once."
        ),
    }


def select_diversified_portfolio(
    slips: list[dict[str, Any]],
    *,
    max_slips_per_player: int = DEFAULT_MAX_SLIPS_PER_PLAYER,
    max_slips_per_game: int = DEFAULT_MAX_SLIPS_PER_GAME,
    max_slips_per_team: int = DEFAULT_MAX_SLIPS_PER_TEAM,
    max_slips: int | None = None,
) -> dict[str, Any]:
    """Greedily keep the highest-EV slips that respect exposure caps.

    Positive expected value is necessary but not sufficient: a slip is dropped
    if taking it would breach a player/team/game exposure cap, even if it is
    +EV, because concentration risk is not worth the marginal edge.
    """
    ordered = sorted(
        list(enumerate(slips)),
        key=lambda item: _float(item[1].get("expectedValue")) or float("-inf"),
        reverse=True,
    )
    player_count: dict[str, int] = defaultdict(int)
    team_count: dict[str, int] = defaultdict(int)
    game_count: dict[str, int] = defaultdict(int)
    selected: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []

    for original_index, slip in ordered:
        players = {p for leg in slip.get("legs") or [] if (p := _player(leg))}
        teams = {t for leg in slip.get("legs") or [] if (t := _team(leg))}
        games = {g for leg in slip.get("legs") or [] if (g := _fixture(leg))}

        reason = None
        if max_slips is not None and len(selected) >= max_slips:
            reason = "max_slips_reached"
        elif any(player_count[p] + 1 > max_slips_per_player for p in players):
            reason = "player_exposure_cap"
        elif any(game_count[g] + 1 > max_slips_per_game for g in games):
            reason = "game_exposure_cap"
        elif any(team_count[t] + 1 > max_slips_per_team for t in teams):
            reason = "team_exposure_cap"

        if reason is not None:
            dropped.append({"slipIndex": original_index, "reason": reason})
            continue

        selected.append(slip)
        for p in players:
            player_count[p] += 1
        for t in teams:
            team_count[t] += 1
        for g in games:
            game_count[g] += 1

    return {
        "selectedSlipCount": len(selected),
        "droppedSlipCount": len(dropped),
        "selectedSlips": selected,
        "dropped": dropped,
        "caps": {
            "maxSlipsPerPlayer": max_slips_per_player,
            "maxSlipsPerGame": max_slips_per_game,
            "maxSlipsPerTeam": max_slips_per_team,
            "maxSlips": max_slips,
        },
        "exposure": slate_exposure_report(selected),
    }


def _player(leg: dict[str, Any]) -> str:
    player = leg.get("player")
    if isinstance(player, dict):
        return slug_key(player.get("key") or player.get("name"))
    return slug_key(player)


def _team(leg: dict[str, Any]) -> str:
    team = leg.get("team")
    if isinstance(team, dict):
        return slug_key(team.get("key") or team.get("name"))
    return slug_key(team)


def _fixture(leg: dict[str, Any]) -> str:
    return slug_key(leg.get("fixtureSlug") or leg.get("matchup"))


def _float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
