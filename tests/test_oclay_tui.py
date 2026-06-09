from app.local_helper_cli import APP_DISPLAY_NAME
from app.local_helper_tui import (
    build_tui_actions,
    format_tui_action_row,
    rich_title_row,
    textual_dependency_status,
)


def test_oclay_tui_exposes_only_simple_actions():
    actions = build_tui_actions()

    assert [action.action_id for action in actions] == [
        "review",
        "build",
        "clean",
        "domain",
        "stop",
        "exit",
    ]
    assert all("Historic" not in action.label for action in actions)
    assert all("M/L" not in action.label for action in actions)


def test_oclay_tui_keeps_two_bracket_row_format():
    row = format_tui_action_row(build_tui_actions()[0], width=48)

    assert row.startswith("[ ")
    assert row.endswith(" ]")
    assert row.count("[") == 1
    assert row.count("]") == 1
    assert "Review" in row
    assert "ctrl+r" in row


def test_oclay_branding_uses_display_name():
    assert APP_DISPLAY_NAME == "Oclay"
    assert "Oclay" in rich_title_row("ready").plain


def test_textual_dependency_probe_shape():
    status = textual_dependency_status()

    assert set(status) == {"available", "error"}
