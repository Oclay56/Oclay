from __future__ import annotations

import app.stake_sgm_browser as sb
from app.stake_sgm_browser import (
    StakeRateLimited,
    _replay_block_message,
    read_stake_sgm_boards_batch,
)


def test_replay_block_message_flags_rate_limits():
    assert _replay_block_message(429, "whatever") is not None
    assert _replay_block_message(503, "Stake under Maintenance") is not None
    assert _replay_block_message(403, "<title>ip-blocked</title>") is not None
    assert _replay_block_message(403, "too many requests") is not None
    # A normal non-block error is not classified as a rate-limit.
    assert _replay_block_message(500, "internal error") is None


def test_batch_circuit_breaks_on_rate_limit(monkeypatch):
    # No real sleeping in tests.
    monkeypatch.setenv("OCLAY_SGM_BOARD_THROTTLE_SECONDS", "0")
    calls: list[str] = []

    def fake_read(fixture_slug, *, cdp_url=None):
        calls.append(fixture_slug)
        if fixture_slug == "g1":
            return {"fixtureSlug": "g1", "playerProps": []}
        if fixture_slug == "g2":
            raise StakeRateLimited("Stake rate-limited the SGM board read (HTTP 429); ...")
        return {"fixtureSlug": fixture_slug, "playerProps": []}

    monkeypatch.setattr(sb, "read_stake_sgm_board", fake_read)

    result = read_stake_sgm_boards_batch(fixture_slugs=["g1", "g2", "g3", "g4"])

    # It stopped at the rate-limit and never called the reader for g3/g4.
    assert calls == ["g1", "g2"]
    assert result["rateLimited"] is True
    assert result["succeeded"] == 1

    statuses = {e["fixtureSlug"]: e["status"] for e in result["errors"]}
    assert statuses["g2"] == "rate_limited"
    assert statuses["g3"] == "skipped"
    assert statuses["g4"] == "skipped"


def test_batch_reports_normal_failures_without_circuit_break(monkeypatch):
    monkeypatch.setenv("OCLAY_SGM_BOARD_THROTTLE_SECONDS", "0")
    calls: list[str] = []

    def fake_read(fixture_slug, *, cdp_url=None):
        calls.append(fixture_slug)
        if fixture_slug == "g2":
            raise RuntimeError("Same Game Multi tab is not visible on this fixture page.")
        return {"fixtureSlug": fixture_slug, "playerProps": []}

    monkeypatch.setattr(sb, "read_stake_sgm_board", fake_read)

    result = read_stake_sgm_boards_batch(fixture_slugs=["g1", "g2", "g3"])

    # A normal per-fixture failure does NOT stop the batch -- all three are tried.
    assert calls == ["g1", "g2", "g3"]
    assert result["rateLimited"] is False
    assert result["succeeded"] == 2
    statuses = {e["fixtureSlug"]: e["status"] for e in result["errors"]}
    assert statuses["g2"] == "failed"
