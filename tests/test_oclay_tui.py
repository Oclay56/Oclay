import json
import os

from app.local_helper_cli import APP_DISPLAY_NAME
from app.local_helper_tui import (
    BACKGROUND_FILL,
    DEFAULT_TUI_PALETTE,
    MENU_FOOTER_CUSHION_HEIGHT,
    MENU_LABEL_TEXT,
    ROW_HOVER_FILL,
    TUI_RGB_PRESET_KEYS,
    build_tui_actions,
    clean_tui_palette,
    format_tui_action_row,
    hex_to_rgb,
    hex_to_windows_colorref,
    keep_tui_preset_path_in_directory,
    load_tui_color_preset,
    rich_tui_action_row,
    rich_title_row,
    rgb_target_label,
    rgb_to_hex,
    save_tui_color_preset,
    textual_dependency_status,
    tui_color_preset_payload,
    tui_color_presets_dir,
    windows_colorref_to_hex,
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


def test_command_lettering_color_does_not_touch_shortcut_text():
    row = rich_tui_action_row(build_tui_actions()[0], palette={"menuLabelText": "#55AAFF"})

    span_styles = [str(span.style) for span in row.spans]

    assert "Review" in row.plain
    assert "ctrl+r" in row.plain
    assert "bold #55AAFF" in span_styles
    assert "#7F7F7F" in span_styles


def test_oclay_branding_uses_display_name():
    assert APP_DISPLAY_NAME == "Oclay"
    assert "Oclay" in rich_title_row("ready").plain


def test_oclay_footer_cushion_keeps_footer_lifted():
    assert MENU_FOOTER_CUSHION_HEIGHT == 5


def test_textual_dependency_probe_shape():
    status = textual_dependency_status()

    assert set(status) == {"available", "error"}


def test_tui_forces_truecolor_rendering():
    assert os.environ["TEXTUAL_COLOR_SYSTEM"] == "truecolor"
    assert os.environ["COLORTERM"] == "truecolor"


def test_background_is_restored_black_fill():
    assert BACKGROUND_FILL == "#111111"
    assert DEFAULT_TUI_PALETTE["background"] == "#111111"
    assert DEFAULT_TUI_PALETTE["panel"] == "#101010"
    assert DEFAULT_TUI_PALETTE["outputPanel"] == "#101010"
    assert DEFAULT_TUI_PALETTE["panelBorder"] == "#5A5A5A"
    assert DEFAULT_TUI_PALETTE["shellBorder"] == "#6A6A6A"
    assert MENU_LABEL_TEXT == "#B8B19C"
    assert DEFAULT_TUI_PALETTE["menuLabelText"] == "#B8B19C"
    assert ROW_HOVER_FILL == "#3A3A3A"


def test_rgb_theme_controls_scoped_targets_only():
    palette = clean_tui_palette(
        {
            "background": "#202A44",
            "panel": "#252525",
            "menuLabelText": "#55AAFF",
            "outputPanel": "#FFFFFF",
            "panelBorder": "#1010FF",
            "shellBorder": "#1010FF",
            "rowHover": "#354A76",
            "highlightText": "#F4F6F8",
        }
    )

    assert palette["background"] == "#202A44"
    assert palette["panel"] == "#252525"
    assert palette["menuLabelText"] == "#55AAFF"
    assert palette["outputPanel"] == "#252525"
    assert palette["panelBorder"] == "#5A5A5A"
    assert palette["shellBorder"] == "#6A6A6A"
    assert palette["rowHover"] == "#3A3A3A"
    assert palette["highlightText"] == "#B8B19C"


def test_rgb_preset_folder_lives_inside_repo_workflow(tmp_path):
    root_dir = tmp_path / "repo"

    assert tui_color_presets_dir(root_dir=root_dir) == root_dir / "data" / "workflow" / "tui-color-presets"


def test_rgb_preset_payload_saves_only_user_rgb_targets(tmp_path):
    preset_path = tmp_path / "my-preset.json"
    palette = clean_tui_palette(
        {
            "background": "#010203",
            "panel": "#040506",
            "menuLabelText": "#070809",
            "shortcutText": "#FFFFFF",
            "panelBorder": "#FFFFFF",
        }
    )

    saved_path = save_tui_color_preset(palette, preset_path)
    raw = json.loads(saved_path.read_text(encoding="utf-8"))
    loaded = load_tui_color_preset(saved_path)

    assert tuple(raw) == tuple(sorted(TUI_RGB_PRESET_KEYS))
    assert raw == tui_color_preset_payload(palette)
    assert loaded == {
        "background": "#010203",
        "panel": "#040506",
        "menuLabelText": "#070809",
    }
    assert "shortcutText" not in raw
    assert "panelBorder" not in raw


def test_rgb_preset_rows_are_named_for_save_and_load():
    assert rgb_target_label("savePreset") == "Save Preset"
    assert rgb_target_label("loadPreset") == "Load Preset"


def test_rgb_preset_save_path_stays_in_preset_folder(tmp_path):
    preset_dir = tmp_path / "repo" / "data" / "workflow" / "tui-color-presets"
    outside_choice = tmp_path / "Desktop" / "night"

    path = keep_tui_preset_path_in_directory(outside_choice, preset_dir)

    assert path == preset_dir / "night.json"


def test_rgb_hex_helpers_clamp_and_parse():
    assert rgb_to_hex(32, 42, 68) == "#202A44"
    assert rgb_to_hex(-1, 300, 68) == "#00FF44"
    assert hex_to_rgb("#202A44") == (32, 42, 68)


def test_windows_colorref_conversion_preserves_rgb_channels():
    colorref = hex_to_windows_colorref("#202A44")

    assert colorref == 0x442A20
    assert windows_colorref_to_hex(colorref) == "#202A44"
    assert windows_colorref_to_hex(0x0000FF) == "#FF0000"
    assert windows_colorref_to_hex(0xFF0000) == "#0000FF"
