from pathlib import Path

from app.local_helper_cli import (
    APP_DISPLAY_NAME,
    COMMAND_ROWS,
    OclayCli,
    _colored_prompt_line,
    format_main_menu,
    strip_ansi,
)


def _passing_setup_report() -> dict:
    return {"ok": True, "checks": [], "warnings": []}


def test_cli_branding_and_command_rows_are_oclay_simple_scope():
    assert APP_DISPLAY_NAME == "Oclay"
    assert COMMAND_ROWS == [
        ("review, r", "Scan board"),
        ("build, b", "Build validated slip"),
        ("domain, q", "Toggle Stake site"),
        ("clean, c", "Clear cache"),
        ("stop, s", "Stop helper"),
        ("exit, e", "Close app"),
    ]


def test_main_menu_uses_oclay_branding_and_only_simple_commands():
    menu = format_main_menu(
        status="ready",
        mode="review-safe",
        browser="checking",
        supabase="checking",
        setup_report=_passing_setup_report(),
    )

    assert "Oclay [ready] CLI v" in menu
    assert "review, r" in menu
    assert "build, b" in menu
    assert "domain, q" in menu
    assert "clean, c" in menu
    assert "stop, s" in menu
    assert "exit, e" in menu
    assert "historic" not in menu.lower()
    assert "analysis" not in menu.lower()
    assert "doctor" not in menu.lower()
    assert menu.rstrip().endswith("oclay [ready] >")


def test_prompt_animation_keeps_oclay_marker_stable():
    assert strip_ansi(_colored_prompt_line("ready", trailing_space=True)) == "oclay [ready] > "
    assert strip_ansi(_colored_prompt_line("building", trailing_space=True, frame=0)).endswith("[building] .   > ")
    assert strip_ansi(_colored_prompt_line("building", trailing_space=True, frame=2)).endswith("[building] ... > ")


def test_command_aliases_route_to_simple_actions(monkeypatch):
    cli = OclayCli(root_dir=Path("C:/fake/OCLAY"))
    calls: list[tuple[str, str | None]] = []

    monkeypatch.setattr(cli, "start_helper", lambda mode: calls.append(("start", mode)))
    monkeypatch.setattr(cli, "toggle_stake_site", lambda: calls.append(("domain", None)))
    monkeypatch.setattr(cli, "run_cache_cleanup", lambda assume_yes=False: calls.append(("clean", str(assume_yes))))
    monkeypatch.setattr(cli, "stop_helper", lambda: calls.append(("stop", None)))

    for command in ["r", "build", "q", "clean --yes", "s", "e"]:
        cli.handle_command(command)

    assert calls == [
        ("start", "review"),
        ("start", "build"),
        ("domain", None),
        ("clean", "True"),
        ("stop", None),
    ]
    assert calls[-1] == ("stop", None)


def test_cleanup_returns_prompt_to_ready(monkeypatch, tmp_path):
    (tmp_path / ".venv" / "Scripts").mkdir(parents=True)
    (tmp_path / ".venv" / "Scripts" / "python.exe").write_text("", encoding="utf-8")
    (tmp_path / ".env").write_text("SUPABASE_URL=x\nSUPABASE_SERVICE_ROLE_KEY=x\n", encoding="utf-8")

    class Completed:
        returncode = 0
        stdout = "OCLAY cache cleanup\n"

    monkeypatch.setattr("app.local_helper_cli.subprocess.run", lambda *args, **kwargs: Completed())
    cli = OclayCli(root_dir=tmp_path, output_func=lambda text: None)

    cli.run_cache_cleanup(assume_yes=True)

    assert cli.status == "ready"
    assert cli.rich_prompt().plain == "oclay [ready] > "
