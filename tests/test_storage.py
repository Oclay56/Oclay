import sqlite3

from app.storage import GptActionStore


def test_store_saves_market_mappings(tmp_path):
    db_path = tmp_path / "gpt.sqlite"
    store = GptActionStore(db_path)

    result = store.save_market_mappings(
        [
            {
                "sport": "mlb",
                "stakeDisplayName": "Batter Strikeouts",
                "internalMarketKey": "batter_strikeouts",
                "statKey": "strikeouts",
                "group": "player_props",
                "examples": ["Under 1.5 Batter Strikeouts"],
            }
        ]
    )

    assert result["marketMappingsSaved"] == 1
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "select stake_display_name, internal_market_key, stat_key from market_mappings"
        ).fetchone()
    assert row == ("Batter Strikeouts", "batter_strikeouts", "strikeouts")
