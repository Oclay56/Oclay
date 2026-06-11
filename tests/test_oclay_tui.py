from app.local_helper_cli import APP_DISPLAY_NAME
from app.local_helper_tui import (
    BACKGROUND_FILL,
    DEFAULT_TUI_PALETTE,
    MENU_FOOTER_CUSHION_HEIGHT,
    ROW_HOVER_FILL,
    build_tui_actions,
    clean_tui_palette,
    format_tui_action_row,
    hex_to_rgb,
    rich_title_row,
    rgb_to_hex,
    textual_dependency_status,
)


def test_oclay_tui_exposes_rgb_action_not_palette():
    actions = build_tui_actions()

    assert [action.action_id for action in actions] == [
        "review",
        "build",
        "clean",
        "domain",
        "rgb",
        "stop",
        "exit",
    ]
    assert [action.label for action in actions if action.action_id == "rgb"] == ["RGB"]
    assert [action.shortcut for action in actions if action.action_id == "rgb"] == ["ctrl+g"]
    assert all(action.label != "Palette" for action in actions)
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


def test_background_is_restored_black_fill():
    assert BACKGROUND_FILL == "#111111"
    assert DEFAULT_TUI_PALETTE["background"] == "#111111"
    assert DEFAULT_TUI_PALETTE["panel"] == "#101010"
    assert DEFAULT_TUI_PALETTE["outputPanel"] == "#101010"
    assert DEFAULT_TUI_PALETTE["panelBorder"] == "#5A5A5A"
    assert DEFAULT_TUI_PALETTE["shellBorder"] == "#6A6A6A"
    assert ROW_HOVER_FILL == "#3A3A3A"


def test_rgb_theme_controls_background_and_center_console_only():
    palette = clean_tui_palette(
        {
            "background": "#202A44",
            "panel": "#252525",
            "outputPanel": "#FFFFFF",
            "panelBorder": "#1010FF",
            "shellBorder": "#1010FF",
            "rowHover": "#354A76",
            "highlightText": "#F4F6F8",
        }
    )

    assert palette["background"] == "#202A44"
    assert palette["panel"] == "#252525"
    assert palette["outputPanel"] == "#252525"
    assert palette["panelBorder"] == "#5A5A5A"
    assert palette["shellBorder"] == "#6A6A6A"
    assert palette["rowHover"] == "#3A3A3A"
    assert palette["highlightText"] == "#B8B19C"


def test_rgb_hex_helpers_clamp_and_parse():
    assert rgb_to_hex(32, 42, 68) == "#202A44"
    assert rgb_to_hex(-1, 300, 68) == "#00FF44"
    assert hex_to_rgb("#202A44") == (32, 42, 68)
