from pathlib import Path

from app.local_helper_cli import APP_DISPLAY_NAME
from app.local_helper_tui import (
    BACKGROUND_FRAME_INTERVAL_SECONDS,
    BACKGROUND_FRAME_LIMIT,
    MENU_FOOTER_CUSHION_HEIGHT,
    TerminalGifBackground,
    animated_background_path,
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


def test_oclay_footer_cushion_keeps_footer_lifted():
    assert MENU_FOOTER_CUSHION_HEIGHT == 5


def test_textual_dependency_probe_shape():
    status = textual_dependency_status()

    assert set(status) == {"available", "error"}


def test_animated_background_asset_renders_terminal_frame():
    root_dir = Path(__file__).resolve().parents[1]
    path = animated_background_path(root_dir=root_dir)

    assert path.exists()

    rendered = TerminalGifBackground(path).render(32, 8, 0)
    frame = rendered.plain
    lines = frame.splitlines()

    assert len(lines) == 8
    assert all(len(line) == 32 for line in lines)
    # Particles now render as soft graded dots, each carrying its own color
    # span rather than a single flat style.
    assert any(char in frame for char in "·•*")
    assert any(span.style is not None for span in rendered.spans)


def test_animated_background_keeps_source_gif_pace():
    assert BACKGROUND_FRAME_LIMIT >= 195
    assert BACKGROUND_FRAME_INTERVAL_SECONDS <= 0.03
