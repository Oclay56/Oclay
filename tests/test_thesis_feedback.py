from __future__ import annotations

from app.backtest import run_backtest
from app.calibration import build_thesis_policies
from app.pick_ledger import PickLedger


def _ledger(tmp_path) -> PickLedger:
    return PickLedger(db_path=tmp_path / "ledger.sqlite")


def _slip(slip_id, structure, thesis_tags, odds, legs_meta):
    return {
        "slipId": slip_id,
        "structure": structure,
        "thesisTags": thesis_tags,
        "targetBand": {"min": 50.0, "max": 100.0},
        "rawProductOdds": odds,
        "legs": [
            {
                "rowId": f"{slip_id}:{i}",
                "player": meta[0],
                "normalizedMarketKey": meta[1],
                "side": "over",
                "line": 0.5,
                "odds": meta[2],
                "thesisTag": meta[3],
                "blockIndex": meta[4],
                "probabilityAssessment": {"estimatedProbability": 0.6},
            }
            for i, meta in enumerate(legs_meta)
        ],
    }


def test_record_slip_persists_structure_and_thesis(tmp_path):
    ledger = _ledger(tmp_path)
    ledger.record_slip(
        _slip(
            "s1",
            "2-block",
            ["ace_suppression", "offense_explosion"],
            72.0,
            [("A", "strikeouts", 1.8, "ace_suppression", 0), ("B", "hits", 1.7, "offense_explosion", 1)],
        ),
        slate_date="2025-05-08",
    )
    slips = ledger.decided_slips_with_legs()  # still pending -> not returned
    assert slips == []

    with ledger._connect() as conn:
        row = dict(conn.execute("SELECT * FROM slips WHERE slip_id='s1'").fetchone())
    assert row["structure"] == "2-block"
    assert "ace_suppression" in row["thesis_tags"]
    assert row["target_low"] == 50.0

    with ledger._connect() as conn:
        legs = [dict(r) for r in conn.execute("SELECT * FROM slip_legs WHERE slip_id='s1'").fetchall()]
    assert {leg["thesis_tag"] for leg in legs} == {"ace_suppression", "offense_explosion"}
    assert {leg["block_index"] for leg in legs} == {0, 1}


def test_thesis_policy_roundtrip(tmp_path):
    ledger = _ledger(tmp_path)
    ledger.save_thesis_policies(
        {
            "offense_explosion": {"status": "exclude", "samples": 30, "realizedRoi": -0.2, "winRate": 0.1},
            "ace_suppression": {"status": "ok", "samples": 40, "realizedRoi": 0.08, "winRate": 0.3},
            "ignored": {"status": "insufficient_data", "samples": 2, "realizedRoi": None, "winRate": None},
        }
    )
    loaded = ledger.load_thesis_policies()
    assert loaded["offense_explosion"]["status"] == "exclude"
    assert loaded["ace_suppression"]["status"] == "ok"
    # insufficient_data is not persisted as actionable.
    assert "ignored" not in loaded


def _settle(ledger, slip_id, result):
    with ledger._connect() as conn:
        conn.execute("UPDATE slips SET result=? WHERE slip_id=?", (result, slip_id))
        conn.commit()


def test_backtest_slices_by_structure_and_thesis(tmp_path):
    ledger = _ledger(tmp_path)
    # Two 2-block winners on ace_suppression, one 2-block loser on offense_explosion.
    ledger.record_slip(_slip("w1", "2-block", ["ace_suppression"], 30.0,
                             [("A", "strikeouts", 1.8, "ace_suppression", 0), ("B", "hits", 1.7, "ace_suppression", 1)]),
                        slate_date="2025-05-08")
    ledger.record_slip(_slip("w2", "2-block", ["ace_suppression"], 30.0,
                             [("C", "strikeouts", 1.8, "ace_suppression", 0), ("D", "hits", 1.7, "ace_suppression", 1)]),
                        slate_date="2025-05-09")
    ledger.record_slip(_slip("l1", "2-block", ["offense_explosion"], 30.0,
                             [("E", "hits", 1.8, "offense_explosion", 0), ("F", "total_bases", 1.7, "offense_explosion", 1)]),
                        slate_date="2025-05-10")
    _settle(ledger, "w1", "win")
    _settle(ledger, "w2", "win")
    _settle(ledger, "l1", "loss")

    report = run_backtest(ledger, min_market_samples=1)

    structures = {s["structure"]: s for s in report["structurePerformance"]["structures"]}
    assert structures["2-block"]["slips"] == 3
    # Two +29.0 winners and one -1.0 loser over three units.
    assert structures["2-block"]["roi"] == round((29.0 + 29.0 - 1.0) / 3, 4)

    theses = {t["thesisTag"]: t for t in report["thesisPerformance"]["theses"]}
    assert theses["ace_suppression"]["slips"] == 2
    assert theses["ace_suppression"]["winRate"] == 1.0
    assert theses["offense_explosion"]["roi"] == -1.0


def test_thesis_kill_switch_excludes_losing_thesis(tmp_path):
    # 25 decided slips on a losing thesis -> excluded; a profitable one stays ok.
    decided = []
    for i in range(25):
        decided.append({"result": "loss", "raw_product_odds": 30.0, "thesisTags": ["coinflip_lotto"]})
    for i in range(25):
        result = "win" if i % 2 == 0 else "loss"
        decided.append({"result": result, "raw_product_odds": 3.0, "thesisTags": ["ace_suppression"]})

    policies = build_thesis_policies(decided)
    assert policies["coinflip_lotto"]["status"] == "exclude"
    assert policies["coinflip_lotto"]["realizedRoi"] < 0
    # ace_suppression: 13 wins at +2.0, 12 losses at -1.0 over 25 -> positive ROI.
    assert policies["ace_suppression"]["status"] == "ok"


def test_thesis_policy_needs_minimum_sample(tmp_path):
    decided = [{"result": "loss", "raw_product_odds": 30.0, "thesisTags": ["thin"]} for _ in range(5)]
    policies = build_thesis_policies(decided)
    assert policies["thin"]["status"] == "insufficient_data"
