from __future__ import annotations

from app.exposure import select_diversified_portfolio, slate_exposure_report


def _slip(ev, *legs):
    return {
        "expectedValue": ev,
        "legs": [
            {"fixtureSlug": f, "player": p, "team": t}
            for (f, p, t) in legs
        ],
    }


def test_exposure_report_flags_over_exposed_player():
    slips = [
        _slip(0.2, ("g1", "Altuve", "Astros"), ("g1", "Tucker", "Astros")),
        _slip(0.1, ("g2", "Altuve", "Astros"), ("g2", "Pena", "Astros")),
        _slip(0.05, ("g3", "Altuve", "Astros"), ("g3", "Alvarez", "Astros")),
    ]
    report = slate_exposure_report(slips)
    top_player = report["topPlayerExposure"][0]
    assert top_player["key"] == "altuve"
    assert top_player["slips"] == 3
    assert "player_over_exposed" in report["concentrationFlags"]


def test_diversified_portfolio_drops_over_exposed_slip_keeping_highest_ev():
    slips = [
        _slip(0.30, ("g1", "Altuve", "Astros")),
        _slip(0.20, ("g2", "Altuve", "Astros")),
        _slip(0.10, ("g3", "Altuve", "Astros")),  # 3rd Altuve slip -> over cap
        _slip(0.05, ("g4", "Judge", "Yankees")),
    ]
    result = select_diversified_portfolio(slips, max_slips_per_player=2)
    assert result["selectedSlipCount"] == 3  # two Altuve + one Judge
    assert result["droppedSlipCount"] == 1
    assert result["dropped"][0]["reason"] == "player_exposure_cap"
    # The dropped Altuve slip is the lowest-EV one (0.10), not a higher one.
    assert result["dropped"][0]["slipIndex"] == 2


def test_max_slips_cap_respected():
    slips = [_slip(0.3 - i * 0.05, (f"g{i}", f"P{i}", f"T{i}")) for i in range(5)]
    result = select_diversified_portfolio(slips, max_slips=2)
    assert result["selectedSlipCount"] == 2
