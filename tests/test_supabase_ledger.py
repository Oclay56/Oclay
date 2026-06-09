from pathlib import Path


def test_supabase_schema_is_simple_oclay_scope():
    sql = Path("supabase/gpt_action.sql").read_text(encoding="utf-8").lower()

    assert "create table if not exists public.market_mappings" in sql
    assert "create table if not exists public.local_ui_jobs" in sql
    assert "create table if not exists public.bet_history" not in sql
    assert "gpt_decision_requests" not in sql
    assert "gpt_decision_legs" not in sql
    assert "enable row level security" in sql
