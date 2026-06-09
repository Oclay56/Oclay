from __future__ import annotations

from app.local_helper_setup import check_local_helper_setup, format_setup_report


def test_setup_check_reports_ready_when_required_local_bits_exist(tmp_path, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    chrome_path = tmp_path / "chrome.exe"
    chrome_path.write_text("", encoding="utf-8")
    python_exe = tmp_path / ".venv" / "Scripts" / "python.exe"
    python_exe.parent.mkdir(parents=True)
    python_exe.write_text("", encoding="utf-8")
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "SUPABASE_URL=https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY=test-key",
                f"AZP_CHROME_PATH={chrome_path}",
            ]
        ),
        encoding="utf-8",
    )

    report = check_local_helper_setup(tmp_path)

    assert report["ok"] is True
    assert "Ready." in format_setup_report(report)


def test_setup_check_reports_missing_required_items(tmp_path, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("AZP_CHROME_PATH", raising=False)

    report = check_local_helper_setup(tmp_path)
    report_text = format_setup_report(report)

    assert report["ok"] is False
    assert "[MISSING] Python venv" in report_text
    assert "[MISSING] .env file" in report_text
    assert "Fix missing items before starting the helper." in report_text
