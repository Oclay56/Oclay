from __future__ import annotations

import argparse
import json
import os
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from rich.text import Text

from .local_helper_cli import (
    APP_DISPLAY_NAME,
    CLI_VERSION,
    OclayCli,
    ROOT_DIR,
    check_local_helper_setup,
    stake_site_profile,
)

BACKGROUND_FILL = "#111111"
PANEL_FILL = "#101010"
PANEL_BORDER_COLOR = "#5A5A5A"
SHELL_BORDER_COLOR = "#6A6A6A"
ROW_HOVER_FILL = "#3A3A3A"
MENU_LABEL_TEXT = "#B8B19C"

os.environ.setdefault("COLORTERM", "truecolor")
os.environ["TEXTUAL_COLOR_SYSTEM"] = "truecolor"

try:
    from textual import events
    from textual.app import App, ComposeResult
    from textual.containers import Container, Vertical
    from textual.widgets import Label, ListItem, ListView, Static

    TEXTUAL_AVAILABLE = True
    TEXTUAL_IMPORT_ERROR = ""
except Exception as exc:  # pragma: no cover - depends on local optional package.
    events = object
    App = object
    ComposeResult = Any
    Container = Vertical = Label = ListItem = ListView = Static = object
    TEXTUAL_AVAILABLE = False
    TEXTUAL_IMPORT_ERROR = str(exc)


DEFAULT_TUI_PALETTE = {
    "background": BACKGROUND_FILL,
    "panel": PANEL_FILL,
    "panelBorder": PANEL_BORDER_COLOR,
    "shellBorder": SHELL_BORDER_COLOR,
    "mutedText": "#7F7F7F",
    "highlightText": "#B8B19C",
    "titleText": "#F1EED0",
    "accentText": "#A46214",
    "readyText": "#00E701",
    "activeText": "#74B9FF",
    "errorText": "#FF6B8A",
    "rowHover": ROW_HOVER_FILL,
    "rowText": "#B8B19C",
    "menuLabelText": MENU_LABEL_TEXT,
    "shortcutText": "#7F7F7F",
    "outputPanel": PANEL_FILL,
}
PINNED_TUI_PALETTE = {
    "panelBorder": PANEL_BORDER_COLOR,
    "shellBorder": SHELL_BORDER_COLOR,
    "rowHover": ROW_HOVER_FILL,
    "highlightText": "#B8B19C",
}
MENU_ROW_WIDTH = 94
TITLE_ROW_WIDTH = 106
OUTPUT_PANEL_WIDTH = 104
OUTPUT_VISIBLE_HEIGHT = 7
OUTPUT_TEXT_WIDTH = 98
MENU_FOOTER_CUSHION_HEIGHT = 3
ENABLE_MOUSE_INPUT = 0x0010
ENABLE_QUICK_EDIT_MODE = 0x0040
ENABLE_EXTENDED_FLAGS = 0x0080
ENABLE_WINDOW_INPUT = 0x0008
ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200
STD_INPUT_HANDLE = -10
@dataclass(frozen=True)
class TuiAction:
    action_id: str
    label: str
    shortcut: str
    description: str
    command: str
    running_label: str
    confirm: bool = False


TUI_ACTIONS: tuple[TuiAction, ...] = (
    TuiAction("review", "Review", "ctrl+r", "Review the visible Stake board.", "review", "Reviewing"),
    TuiAction("build", "Build", "ctrl+b", "Open builder mode for validated slips.", "build", "Building"),
    TuiAction("trainer", "Trainer", "ctrl+t", "Grade settled picks and recalibrate the model.", "trainer", "Training"),
    TuiAction("honest", "Honest", "ctrl+h", "Is the model honest? Point-in-time calibration check.", "honest", "Validating"),
    TuiAction("profitable", "Profitable", "ctrl+p", "Is it profitable? Realized hit rate and slip ROI.", "profitable", "Backtesting"),
    TuiAction("clean", "Clean", "ctrl+c", "Clear rebuildable cache.", "clean", "Cleaning"),
    TuiAction("domain", "Domain", "ctrl+q", "Toggle Stake domain profile.", "domain", "Switching domain"),
    TuiAction("rgb", "RGB", "ctrl+g", "Tune TUI background colors.", "rgb", "RGB"),
    TuiAction("stop", "Stop", "ctrl+s", "Stop the active helper task.", "stop", "Stop"),
    TuiAction("exit", "Exit", "ctrl+e", "Close the TUI.", "exit", "Exiting"),
)
MENU_ROW_COUNT = len(TUI_ACTIONS)
# Actions whose report opens in its own console window: id -> (cli command, status).
REPORT_WINDOW_COMMANDS: dict[str, tuple[str, str]] = {
    "trainer": ("loop", "training"),
    "honest": ("model-backtest", "validating"),
    "profitable": ("backtest", "backtesting"),
}
TUI_RGB_PRESET_KEYS = ("background", "panel", "menuLabelText")
RGB_COLOR_TARGET_IDS = frozenset(TUI_RGB_PRESET_KEYS)
RGB_PRESET_SAVE_ID = "savePreset"
RGB_PRESET_LOAD_ID = "loadPreset"
RGB_TARGET_ROW_COUNT = len(TUI_RGB_PRESET_KEYS) + 2


def tui_theme_path(*, root_dir: Path = ROOT_DIR) -> Path:
    return root_dir / "data" / "workflow" / "helper-tui-theme.json"


def tui_color_presets_dir(*, root_dir: Path = ROOT_DIR) -> Path:
    return root_dir / "data" / "workflow" / "tui-color-presets"


def clean_tui_palette(raw: dict[str, Any] | None = None) -> dict[str, str]:
    palette = dict(DEFAULT_TUI_PALETTE)
    if not isinstance(raw, dict):
        palette.update(PINNED_TUI_PALETTE)
        return palette
    for key, value in raw.items():
        if key in palette and isinstance(value, str) and _is_hex_color(value):
            palette[key] = value.upper()
    palette["outputPanel"] = palette["panel"]
    palette.update(PINNED_TUI_PALETTE)
    return palette


def load_tui_palette(path: Path | None = None, *, root_dir: Path = ROOT_DIR) -> dict[str, str]:
    settings_path = path or tui_theme_path(root_dir=root_dir)
    try:
        raw = json.loads(settings_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_TUI_PALETTE)
    return clean_tui_palette(raw)


def save_tui_palette(
    palette: dict[str, str],
    path: Path | None = None,
    *,
    root_dir: Path = ROOT_DIR,
) -> Path:
    settings_path = path or tui_theme_path(root_dir=root_dir)
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    clean = clean_tui_palette(palette)
    settings_path.write_text(json.dumps(clean, indent=2) + "\n", encoding="utf-8")
    return settings_path


def tui_color_preset_payload(palette: dict[str, str]) -> dict[str, str]:
    clean = clean_tui_palette(palette)
    return {key: clean[key] for key in TUI_RGB_PRESET_KEYS}


def save_tui_color_preset(palette: dict[str, str], path: Path) -> Path:
    preset_path = Path(path)
    if preset_path.suffix.lower() != ".json":
        preset_path = preset_path.with_suffix(".json")
    preset_path.parent.mkdir(parents=True, exist_ok=True)
    preset_path.write_text(
        json.dumps(tui_color_preset_payload(palette), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return preset_path


def load_tui_color_preset(path: Path) -> dict[str, str]:
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("Could not read that RGB preset.") from exc
    if not isinstance(raw, dict):
        raise ValueError("That RGB preset is not valid.")
    preset: dict[str, str] = {}
    for key in TUI_RGB_PRESET_KEYS:
        value = raw.get(key)
        if not isinstance(value, str) or not _is_hex_color(value):
            raise ValueError(f"That RGB preset is missing {rgb_target_label(key)}.")
        preset[key] = value.upper()
    return preset


def _path_inside_directory(path: Path, directory: Path) -> bool:
    try:
        path.resolve().relative_to(directory.resolve())
    except ValueError:
        return False
    return True


def keep_tui_preset_path_in_directory(path: Path, directory: Path) -> Path:
    preset_dir = directory.resolve()
    preset_path = Path(path)
    if preset_path.suffix.lower() != ".json":
        preset_path = preset_path.with_suffix(".json")
    if not _path_inside_directory(preset_path, preset_dir):
        return preset_dir / preset_path.name
    return preset_path


def textual_dependency_status() -> dict[str, Any]:
    return {"available": TEXTUAL_AVAILABLE, "error": TEXTUAL_IMPORT_ERROR}


def console_input_mode_without_text_selection(mode: int) -> int:
    return (
        int(mode)
        | ENABLE_EXTENDED_FLAGS
        | ENABLE_MOUSE_INPUT
        | ENABLE_WINDOW_INPUT
        | ENABLE_VIRTUAL_TERMINAL_INPUT
    ) & ~ENABLE_QUICK_EDIT_MODE


def disable_terminal_text_selection() -> bool:
    if os.name != "nt":
        return False
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(STD_INPUT_HANDLE)
        mode = ctypes.c_uint32()
        if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        next_mode = console_input_mode_without_text_selection(mode.value)
        return bool(kernel32.SetConsoleMode(handle, next_mode))
    except Exception:
        return False


def build_tui_actions() -> tuple[TuiAction, ...]:
    return TUI_ACTIONS


def find_tui_action(action_id: str) -> TuiAction | None:
    clean_id = action_id.strip().lower()
    for action in TUI_ACTIONS:
        if action.action_id == clean_id or action.command == clean_id:
            return action
    return None


def format_tui_action_row(action: TuiAction, *, width: int = MENU_ROW_WIDTH) -> str:
    inner_width = max(width - 2, 24)
    left = f" {action.label}"
    right = f"{action.shortcut} "
    gap = " " * max(inner_width - len(left) - len(right), 1)
    return f"[{left}{gap}{right}]"


def rich_tui_action_row(
    action: TuiAction,
    *,
    width: int = MENU_ROW_WIDTH,
    palette: dict[str, str] | None = None,
    hovered: bool = False,
) -> Text:
    colors = clean_tui_palette(palette)
    row = format_tui_action_row(action, width=width)
    if hovered:
        base_style = f"{colors['shortcutText']} on {colors['rowHover']}"
        label_style = f"bold {colors['highlightText']} on {colors['rowHover']}"
        shortcut_style = f"{colors['shortcutText']} on {colors['rowHover']}"
    else:
        base_style = colors["shortcutText"]
        label_style = f"bold {colors['menuLabelText']}"
        shortcut_style = colors["shortcutText"]
    text = Text(row, style=base_style)
    label_start = 2
    label_end = label_start + len(action.label)
    text.stylize(label_style, label_start, label_end)
    text.stylize(shortcut_style, max(0, row.rfind(action.shortcut)), len(row) - 1)
    return text


def rich_title_row(
    system_state: str,
    *,
    frame: int = 2,
    width: int = TITLE_ROW_WIDTH,
    palette: dict[str, str] | None = None,
) -> Text:
    colors = clean_tui_palette(palette)
    left = f"{APP_DISPLAY_NAME} "
    version = f"[v{CLI_VERSION}]"
    display_state, role = _display_status_parts(system_state, frame=frame)
    right = f"System: {display_state}"
    gap = " " * max(width - len(left) - len(version) - len(right), 1)
    text = Text()
    text.append(left, style=colors["mutedText"])
    text.append(version, style=colors["titleText"])
    text.append(gap, style=colors["mutedText"])
    text.append("System: ", style=colors["mutedText"])
    role_color = {
        "ready": colors["readyText"],
        "active": colors["activeText"],
        "error": colors["errorText"],
    }.get(role, colors["mutedText"])
    text.append(display_state, style=role_color)
    return text


def rich_stake_site_row(
    site_label: str,
    *,
    width: int = TITLE_ROW_WIDTH,
    palette: dict[str, str] | None = None,
) -> Text:
    colors = clean_tui_palette(palette)
    label = "Stake site: "
    display_site = f"[{site_label}]"
    right = f"{label}{display_site}"
    gap = " " * max(width - len(right), 0)
    text = Text(f"{gap}{label}", style=colors["mutedText"])
    text.append(display_site, style=colors["accentText"])
    return text


def format_running_status(action: TuiAction, *, frame: int = 2) -> str:
    dots = "." * ((frame % 3) + 1)
    return f"[ {action.running_label} ]{dots:<3}"


def rich_page_status(
    action: TuiAction,
    *,
    frame: int = 2,
    page_result: str = "",
    palette: dict[str, str] | None = None,
) -> Text:
    colors = clean_tui_palette(palette)
    if page_result == "done":
        return Text("[ Done ]", style=colors["readyText"])
    if page_result == "failed":
        return Text("[ Failed ]", style=colors["errorText"])
    return Text(format_running_status(action, frame=frame), style=colors["activeText"])


def _display_status_parts(status: str, *, frame: int = 2) -> tuple[str, str]:
    clean = str(status or "ready").strip().lower()
    aliases = {
        "cleaning cache": "cleaning",
        "setup ready": "ready",
    }
    clean = aliases.get(clean, clean)
    if clean == "ready":
        return "[ready]", "ready"
    if "error" in clean or "failed" in clean or "needs attention" in clean:
        return f"[{clean}]", "error"
    dots = "." * ((frame % 3) + 1)
    padded_dots = f"{dots:<3}"
    return f"[{clean}] {padded_dots}", "active"


def _is_hex_color(value: str) -> bool:
    text = value.strip()
    if len(text) != 7 or not text.startswith("#"):
        return False
    return all(char in "0123456789abcdefABCDEF" for char in text[1:])


def _clamp_rgb_value(value: int) -> int:
    return max(0, min(255, int(value)))


def rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{_clamp_rgb_value(r):02X}{_clamp_rgb_value(g):02X}{_clamp_rgb_value(b):02X}"


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    clean = value.strip()
    if not _is_hex_color(clean):
        clean = DEFAULT_TUI_PALETTE["background"]
    return int(clean[1:3], 16), int(clean[3:5], 16), int(clean[5:7], 16)


def hex_to_windows_colorref(value: str) -> int:
    r, g, b = hex_to_rgb(value)
    return r | (g << 8) | (b << 16)


def windows_colorref_to_hex(value: int) -> str:
    colorref = int(value)
    return rgb_to_hex(colorref & 0xFF, (colorref >> 8) & 0xFF, (colorref >> 16) & 0xFF)


def rgb_target_label(target_id: str) -> str:
    if target_id == "background":
        return "Background"
    if target_id == "panel":
        return "Center Console"
    if target_id == "menuLabelText":
        return "Command Lettering"
    if target_id == RGB_PRESET_SAVE_ID:
        return "Save Preset"
    if target_id == RGB_PRESET_LOAD_ID:
        return "Load Preset"
    return "RGB"


def rgb_target_color_key(target_id: str) -> str | None:
    return target_id if target_id in RGB_COLOR_TARGET_IDS else None


def rich_rgb_target_row(
    target_id: str,
    *,
    selected: bool = False,
    palette: dict[str, str] | None = None,
    width: int = MENU_ROW_WIDTH,
) -> Text:
    colors = clean_tui_palette(palette)
    label = rgb_target_label(target_id)
    color_key = rgb_target_color_key(target_id)
    left = f" {'>' if selected else ' '} {label}"
    right = f"{colors[color_key]} " if color_key is not None else "file "
    inner_width = max(width - 2, 24)
    row = f"[{left}{' ' * max(inner_width - len(left) - len(right), 1)}{right}]"
    style = f"{colors['highlightText']} on {colors['rowHover']}" if selected else colors["shortcutText"]
    text = Text(row, style=style)
    text.stylize(
        f"bold {colors['highlightText'] if selected else colors['rowText']}"
        + (f" on {colors['rowHover']}" if selected else ""),
        4,
        4 + len(label),
    )
    return text


def choose_native_rgb_color(initial_color: str, *, title: str = "OCLAY RGB") -> str | None:
    clean_initial = initial_color.upper() if _is_hex_color(initial_color) else DEFAULT_TUI_PALETTE["background"]
    try:
        import ctypes
        from ctypes import wintypes

        class CHOOSECOLORW(ctypes.Structure):
            _fields_ = [
                ("lStructSize", wintypes.DWORD),
                ("hwndOwner", wintypes.HWND),
                ("hInstance", wintypes.HWND),
                ("rgbResult", wintypes.COLORREF),
                ("lpCustColors", ctypes.POINTER(wintypes.COLORREF)),
                ("Flags", wintypes.DWORD),
                ("lCustData", wintypes.LPARAM),
                ("lpfnHook", wintypes.LPVOID),
                ("lpTemplateName", wintypes.LPCWSTR),
            ]

        CC_RGBINIT = 0x00000001
        CC_FULLOPEN = 0x00000002
        CC_ANYCOLOR = 0x00000100
        custom_colors = (wintypes.COLORREF * 16)(*[hex_to_windows_colorref(clean_initial)] * 16)
        choose_color = ctypes.windll.comdlg32.ChooseColorW
        choose_color.argtypes = [ctypes.POINTER(CHOOSECOLORW)]
        choose_color.restype = wintypes.BOOL
        get_foreground_window = ctypes.windll.user32.GetForegroundWindow
        get_foreground_window.argtypes = []
        get_foreground_window.restype = wintypes.HWND
        dialog = CHOOSECOLORW()
        dialog.lStructSize = ctypes.sizeof(CHOOSECOLORW)
        dialog.hwndOwner = get_foreground_window()
        dialog.rgbResult = hex_to_windows_colorref(clean_initial)
        dialog.lpCustColors = custom_colors
        dialog.Flags = CC_RGBINIT | CC_FULLOPEN | CC_ANYCOLOR
        if choose_color(ctypes.byref(dialog)):
            return windows_colorref_to_hex(dialog.rgbResult)
        return None
    except Exception:
        pass

    root = None
    try:
        import tkinter as tk
        from tkinter import colorchooser

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.update()
        _rgb, hex_color = colorchooser.askcolor(color=clean_initial, title=title, parent=root)
        if isinstance(hex_color, str) and _is_hex_color(hex_color):
            return hex_color.upper()
    except Exception:
        pass
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass
    return None


def choose_tui_preset_save_path(preset_dir: Path) -> Path | None:
    preset_dir.mkdir(parents=True, exist_ok=True)
    root = None
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.update()
        selected = filedialog.asksaveasfilename(
            title="Save OCLAY RGB preset",
            initialdir=str(preset_dir),
            defaultextension=".json",
            filetypes=[("OCLAY RGB presets", "*.json"), ("JSON files", "*.json")],
            parent=root,
        )
        return Path(selected) if selected else None
    except Exception:
        return None
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass


def choose_tui_preset_load_path(preset_dir: Path) -> Path | None:
    preset_dir.mkdir(parents=True, exist_ok=True)
    root = None
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.update()
        selected = filedialog.askopenfilename(
            title="Load OCLAY RGB preset",
            initialdir=str(preset_dir),
            filetypes=[("OCLAY RGB presets", "*.json"), ("JSON files", "*.json")],
            parent=root,
        )
        return Path(selected) if selected else None
    except Exception:
        return None
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass


if TEXTUAL_AVAILABLE:

    class CommandRow(ListItem):
        def __init__(self, action: TuiAction, *, palette: dict[str, str] | None = None) -> None:
            self.tui_action = action
            super().__init__(Label(rich_tui_action_row(action, palette=palette), classes="command-label"))

        def paint_hover(self, hovered: bool) -> None:
            palette = getattr(self.app, "palette", DEFAULT_TUI_PALETTE)
            background = palette["rowHover"] if hovered else palette["panel"]
            color = palette["highlightText"] if hovered else palette["menuLabelText"]
            self.set_class(hovered, "menu-hover")
            self.styles.background = background
            self.styles.color = color
            label = self.query_one(Label)
            label.styles.background = background
            label.styles.color = color
            label.update(rich_tui_action_row(self.tui_action, palette=palette, hovered=hovered))

        def on_enter(self, event: events.Enter) -> None:
            self.paint_hover(True)

        def on_leave(self, event: events.Leave) -> None:
            self.paint_hover(False)


    class RgbTargetRow(ListItem):
        def __init__(self, target_id: str) -> None:
            self.target_id = target_id
            super().__init__(Label(rich_rgb_target_row(target_id), classes="command-label"))

        def paint_selected(self, selected: bool) -> None:
            palette = getattr(self.app, "palette", DEFAULT_TUI_PALETTE)
            background = palette["rowHover"] if selected else palette["panel"]
            color = palette["highlightText"] if selected else palette["rowText"]
            self.set_class(selected, "target-active")
            self.styles.background = background
            self.styles.color = color
            label = self.query_one(Label)
            label.styles.background = background
            label.styles.color = color
            label.update(rich_rgb_target_row(self.target_id, selected=selected, palette=palette))


    class OclayTui(App[None]):
        CSS = f"""
        Screen {{
            background: {DEFAULT_TUI_PALETTE["background"]};
            color: {DEFAULT_TUI_PALETTE["mutedText"]};
            overflow: hidden hidden;
        }}

        #workspace-top {{
            dock: top;
            height: 3;
            width: 100%;
            padding: 1 1 0 1;
            background: {DEFAULT_TUI_PALETTE["background"]};
            color: {DEFAULT_TUI_PALETTE["mutedText"]};
        }}

        #screen-root {{
            align: center middle;
            height: 1fr;
            width: 100%;
            background: {DEFAULT_TUI_PALETTE["background"]};
        }}

        #shell-stack {{
            width: 116;
            height: 24;
            background: {DEFAULT_TUI_PALETTE["background"]};
        }}

        #shell {{
            width: 116;
            height: 22;
            max-height: 22;
            min-height: 22;
            background: {DEFAULT_TUI_PALETTE["background"]};
            border: round {DEFAULT_TUI_PALETTE["shellBorder"]};
            padding: 0 0;
            overflow: hidden hidden;
        }}

        #shell-inner {{
            width: 100%;
            height: 100%;
            background: {DEFAULT_TUI_PALETTE["panel"]};
            padding: 1 4;
            overflow: hidden hidden;
        }}

        #footer-stable {{
            height: 1;
            width: 116;
            padding: 0 0;
            content-align: right top;
            background: {DEFAULT_TUI_PALETTE["background"]};
            color: {DEFAULT_TUI_PALETTE["mutedText"]};
        }}

        #title,
        #stake-site,
        #page-title,
        #page-status,
        #hint {{
            height: 1;
            color: {DEFAULT_TUI_PALETTE["mutedText"]};
        }}

        #stake-site {{
            color: {DEFAULT_TUI_PALETTE["accentText"]};
            content-align: right top;
        }}

        #spacer {{
            height: 1;
        }}

        #shell-bottom-fill {{
            height: {MENU_FOOTER_CUSHION_HEIGHT};
            background: {DEFAULT_TUI_PALETTE["panel"]};
        }}

        #menu-wrap {{
            width: 100%;
            height: {MENU_ROW_COUNT};
            align: center top;
            background: {DEFAULT_TUI_PALETTE["panel"]};
            overflow: hidden hidden;
        }}

        #actions {{
            width: {MENU_ROW_WIDTH};
            height: {MENU_ROW_COUNT};
            background: {DEFAULT_TUI_PALETTE["panel"]};
            scrollbar-size: 0 0;
            overflow: hidden hidden;
        }}

        CommandRow {{
            width: {MENU_ROW_WIDTH};
            height: 1;
            color: {DEFAULT_TUI_PALETTE["menuLabelText"]};
            background: {DEFAULT_TUI_PALETTE["panel"]};
            padding: 0 0;
        }}

        #actions > CommandRow.-hovered,
        #actions > CommandRow.-highlight,
        #actions > CommandRow.--highlight,
        #actions:focus > CommandRow.-highlight,
        #actions:focus > CommandRow.--highlight {{
            color: {DEFAULT_TUI_PALETTE["menuLabelText"]};
            background: {DEFAULT_TUI_PALETTE["panel"]};
            text-style: none;
        }}

        #actions > CommandRow.-hovered .command-label,
        #actions > CommandRow.-highlight .command-label,
        #actions > CommandRow.--highlight .command-label,
        #actions:focus > CommandRow.-highlight .command-label,
        #actions:focus > CommandRow.--highlight .command-label {{
            background: {DEFAULT_TUI_PALETTE["panel"]};
        }}

        #actions > CommandRow.menu-hover {{
            color: {DEFAULT_TUI_PALETTE["highlightText"]};
            background: {DEFAULT_TUI_PALETTE["rowHover"]};
            text-style: bold;
        }}

        #actions > CommandRow.menu-hover .command-label {{
            color: {DEFAULT_TUI_PALETTE["highlightText"]};
            background: {DEFAULT_TUI_PALETTE["rowHover"]};
            text-style: bold;
        }}

        .command-label {{
            width: {MENU_ROW_WIDTH};
            height: 1;
            background: {DEFAULT_TUI_PALETTE["panel"]};
        }}

        #page-title {{
            text-style: bold;
            color: {DEFAULT_TUI_PALETTE["highlightText"]};
        }}

        #page-status {{
            color: {DEFAULT_TUI_PALETTE["activeText"]};
            margin: 1 0;
        }}

        #output-panel {{
            width: {OUTPUT_PANEL_WIDTH};
            height: 9;
            background: {DEFAULT_TUI_PALETTE["outputPanel"]};
            border: round {DEFAULT_TUI_PALETTE["panelBorder"]};
            padding: 1 2;
            overflow: hidden hidden;
        }}

        #output-text {{
            width: {OUTPUT_TEXT_WIDTH};
            height: {OUTPUT_VISIBLE_HEIGHT};
            color: {DEFAULT_TUI_PALETTE["mutedText"]};
            background: {DEFAULT_TUI_PALETTE["outputPanel"]};
            overflow: hidden hidden;
        }}

        #rgb-panel {{
            height: 1fr;
            background: {DEFAULT_TUI_PALETTE["panel"]};
            overflow: hidden hidden;
        }}

        #rgb-target-label,
        #rgb-help {{
            height: 1;
            color: {DEFAULT_TUI_PALETTE["mutedText"]};
        }}

        #rgb-targets {{
            width: {MENU_ROW_WIDTH};
            height: {RGB_TARGET_ROW_COUNT};
            background: {DEFAULT_TUI_PALETTE["panel"]};
            scrollbar-size: 0 0;
            overflow: hidden hidden;
        }}

        RgbTargetRow {{
            width: {MENU_ROW_WIDTH};
            height: 1;
            color: {DEFAULT_TUI_PALETTE["rowText"]};
            background: {DEFAULT_TUI_PALETTE["panel"]};
            padding: 0 0;
        }}

        #rgb-targets > RgbTargetRow.-hovered,
        #rgb-targets > RgbTargetRow.-highlight,
        #rgb-targets > RgbTargetRow.--highlight,
        #rgb-targets:focus > RgbTargetRow.-highlight,
        #rgb-targets:focus > RgbTargetRow.--highlight {{
            color: {DEFAULT_TUI_PALETTE["rowText"]};
            background: {DEFAULT_TUI_PALETTE["panel"]};
            text-style: none;
        }}

        #rgb-targets > RgbTargetRow.target-active,
        #rgb-targets > RgbTargetRow.target-active .command-label {{
            color: {DEFAULT_TUI_PALETTE["highlightText"]};
            background: {DEFAULT_TUI_PALETTE["rowHover"]};
            text-style: bold;
        }}

        #hint {{
            margin-top: 1;
        }}

        .hidden {{
            display: none;
        }}
        """

        BINDINGS = [
            ("ctrl+r", "run_action('review')", "Review"),
            ("ctrl+b", "run_action('build')", "Build"),
            ("ctrl+t", "run_action('trainer')", "Trainer"),
            ("ctrl+h", "run_action('honest')", "Honest"),
            ("ctrl+p", "run_action('profitable')", "Profitable"),
            ("ctrl+c", "run_action('clean')", "Clean"),
            ("ctrl+q", "run_action('domain')", "Domain"),
            ("ctrl+g", "run_action('rgb')", "RGB"),
            ("ctrl+s", "run_action('stop')", "Stop"),
            ("ctrl+e", "run_action('exit')", "Exit"),
            ("r", "run_action('review')", "Review"),
            ("b", "run_action('build')", "Build"),
            ("t", "run_action('trainer')", "Trainer"),
            ("h", "run_action('honest')", "Honest"),
            ("p", "run_action('profitable')", "Profitable"),
            ("c", "run_action('clean')", "Clean"),
            ("q", "run_action('domain')", "Domain"),
            ("g", "run_action('rgb')", "RGB"),
            ("s", "run_action('stop')", "Stop"),
            ("e", "run_action('exit')", "Exit"),
            ("escape", "back", "Back"),
        ]

        def __init__(self, *, root_dir: Path = ROOT_DIR) -> None:
            super().__init__()
            self.root_dir = root_dir
            self.display_workspace = Path.home()
            self.palette = load_tui_palette(root_dir=root_dir)
            self.ui_thread: threading.Thread | None = None
            self.cli = OclayCli(
                root_dir=root_dir,
                output_func=self._append_output,
                input_func=lambda prompt="": "",
            )
            self._active_action: TuiAction | None = None
            self._busy = False
            self._confirm_clean_until = 0.0
            self._status_frame = 0
            self._last_render_state: tuple[Any, ...] | None = None
            self._setup_state = "checking"
            self._active_subprocess: Any = None
            self._selected_rgb_target = "background"
            self._stop_requested = False
            self._inline_message = ""
            self._output_lines: list[str] = []
            self._output_scroll = 0
            self._page_result = ""
            self._last_pointer_action: tuple[str, float] = ("", 0.0)
            self._open_report_windows = 0

        def compose(self) -> ComposeResult:
            yield Static("", id="workspace-top")
            with Container(id="screen-root"):
                with Vertical(id="shell-stack"):
                    with Vertical(id="shell"):
                        with Vertical(id="shell-inner"):
                            yield Static("", id="title")
                            yield Static("", id="spacer")
                            with Container(id="menu-wrap"):
                                yield ListView(
                                    *[CommandRow(action, palette=self.palette) for action in TUI_ACTIONS],
                                    id="actions",
                                )
                            yield Static("", id="page-title", classes="hidden")
                            yield Static("", id="page-status", classes="hidden")
                            with Container(id="output-panel", classes="hidden"):
                                yield Static("", id="output-text")
                            with Vertical(id="rgb-panel", classes="hidden"):
                                yield Static("", id="rgb-target-label")
                                yield ListView(
                                    RgbTargetRow("background"),
                                    RgbTargetRow("panel"),
                                    RgbTargetRow("menuLabelText"),
                                    RgbTargetRow(RGB_PRESET_SAVE_ID),
                                    RgbTargetRow(RGB_PRESET_LOAD_ID),
                                    id="rgb-targets",
                                )
                                yield Static("", id="rgb-help")
                            yield Static("", id="shell-bottom-fill")
                            yield Static("", id="hint")
                            yield Static("", id="stake-site")
                    yield Static("[stable]", id="footer-stable")

        def on_mount(self) -> None:
            disable_terminal_text_selection()
            self.ui_thread = threading.current_thread()
            self._setup_state = self._read_setup_state()
            self._apply_palette()
            self._refresh_layout(force=True)
            self.set_interval(0.45, self._tick)

        def _apply_palette(self) -> None:
            root = self.query_one("#screen-root", Container)
            workspace_top = self.query_one("#workspace-top", Static)
            footer_stable = self.query_one("#footer-stable", Static)
            shell_stack = self.query_one("#shell-stack", Vertical)
            shell = self.query_one("#shell", Vertical)
            shell_inner = self.query_one("#shell-inner", Vertical)
            bottom_fill = self.query_one("#shell-bottom-fill", Static)
            menu_wrap = self.query_one("#menu-wrap", Container)
            actions = self.query_one("#actions", ListView)
            output_panel = self.query_one("#output-panel", Container)
            output_text = self.query_one("#output-text", Static)
            rgb_panel = self.query_one("#rgb-panel", Vertical)
            rgb_targets = self.query_one("#rgb-targets", ListView)

            root.styles.background = self.palette["background"]
            workspace_top.styles.background = self.palette["background"]
            footer_stable.styles.background = self.palette["background"]
            shell_stack.styles.background = self.palette["background"]
            shell.styles.background = self.palette["background"]
            shell.styles.border = ("round", self.palette["shellBorder"])
            shell_inner.styles.background = self.palette["panel"]
            bottom_fill.styles.background = self.palette["panel"]
            menu_wrap.styles.background = self.palette["panel"]
            actions.styles.background = self.palette["panel"]
            output_panel.styles.background = self.palette["outputPanel"]
            output_panel.styles.border = ("round", self.palette["panelBorder"])
            output_text.styles.background = self.palette["outputPanel"]
            rgb_panel.styles.background = self.palette["panel"]
            rgb_targets.styles.background = self.palette["panel"]

            for selector, color in (
                ("#workspace-top", "mutedText"),
                ("#footer-stable", "mutedText"),
                ("#title", "mutedText"),
                ("#stake-site", "mutedText"),
                ("#page-title", "highlightText"),
                ("#page-status", "activeText"),
                ("#output-text", "mutedText"),
                ("#rgb-target-label", "mutedText"),
                ("#rgb-help", "mutedText"),
                ("#hint", "mutedText"),
            ):
                self.query_one(selector, Static).styles.color = self.palette[color]
            for selector in (
                "#title",
                "#spacer",
                "#stake-site",
                "#page-title",
                "#page-status",
                "#hint",
                "#rgb-target-label",
                "#rgb-help",
            ):
                self.query_one(selector, Static).styles.background = self.palette["panel"]
            for row in self.query(CommandRow):
                row.paint_hover(row.has_class("menu-hover"))
            for row in self.query(RgbTargetRow):
                row.paint_selected(row.target_id == self._selected_rgb_target)

        def _tick(self) -> None:
            self.cli.drain_output()
            if self._status_is_active():
                self._status_frame = (self._status_frame + 1) % 3
            self._refresh_layout()

        def _read_setup_state(self) -> str:
            setup = check_local_helper_setup(self.root_dir)
            return "ready" if setup.get("ok") else "needs attention"

        def _display_system_status(self) -> str:
            if self._setup_state == "stopping":
                return "stopping"
            cli_status = str(self.cli.status or "ready").strip().lower()
            if cli_status in {"building", "reviewing", "cleaning cache", "analyzing", "training", "validating", "backtesting"}:
                return cli_status
            if self._busy and self._active_action is not None:
                return self._active_action.running_label.lower()
            if self._setup_state != "ready":
                return self._setup_state
            return "ready"

        def _status_is_active(self) -> bool:
            _, role = _display_status_parts(self._display_system_status(), frame=self._status_frame)
            return role == "active"

        def _refresh_layout(self, *, force: bool = False) -> None:
            profile = stake_site_profile(self.cli.stake_site, root_dir=self.root_dir)
            on_page = self._active_action is not None
            on_rgb = self._active_action is not None and self._active_action.action_id == "rgb"
            page_status: str | Text = ""
            if on_page and self._active_action is not None:
                page_status = rich_page_status(
                    self._active_action,
                    frame=self._status_frame,
                    page_result=self._page_result,
                    palette=self.palette,
                )
            hint_text = self._hint_text(on_page=on_page)
            render_state = (
                str(self.display_workspace),
                profile["label"],
                self._display_system_status(),
                self._status_frame if self._status_is_active() else 0,
                self._active_action.action_id if self._active_action else "",
                self.cli.status,
                self._busy,
                page_status,
                hint_text,
                self._selected_rgb_target,
                self._inline_message,
                self._page_result,
                self._output_scroll,
                len(self._output_lines),
                tuple(sorted(self.palette.items())),
            )
            if not force and render_state == self._last_render_state:
                return
            self._last_render_state = render_state

            self.query_one("#workspace-top", Static).update(str(self.display_workspace))
            self.query_one("#title", Static).update(
                rich_title_row(self._display_system_status(), frame=self._status_frame, palette=self.palette)
            )
            self.query_one("#stake-site", Static).update(rich_stake_site_row(profile["label"], palette=self.palette))

            self.query_one("#menu-wrap", Container).set_class(on_page, "hidden")
            self.query_one("#page-title", Static).set_class(not on_page, "hidden")
            self.query_one("#page-status", Static).set_class((not on_page) or on_rgb, "hidden")
            self.query_one("#output-panel", Container).set_class((not on_page) or on_rgb, "hidden")
            self.query_one("#rgb-panel", Vertical).set_class(not on_rgb, "hidden")

            if on_page and self._active_action is not None:
                self.query_one("#page-title", Static).update(self._active_action.label)
                self.query_one("#page-status", Static).update(page_status)
            if on_rgb:
                self._refresh_rgb_page()
            elif on_page:
                self._refresh_output_panel()

            self.query_one("#hint", Static).update(hint_text)

        def _hint_text(self, *, on_page: bool) -> str:
            if self._confirm_clean_until > time.monotonic():
                return "Press ctrl+c again to confirm cleanup. Escape returns to menu."
            if on_page:
                return "Escape returns to menu. ctrl+e exits."
            if self._inline_message:
                return self._inline_message
            return "Click a row, press Enter, or use ctrl shortcuts."

        def _refresh_rgb_page(self) -> None:
            self.query_one("#rgb-target-label", Static).update("RGB Target")
            self.query_one("#rgb-help", Static).update("Pick a target, or save/load an RGB preset.")
            for row in self.query(RgbTargetRow):
                row.paint_selected(False)

        def _append_output(self, text: str) -> None:
            if self.ui_thread is threading.current_thread():
                self._write_output(text)
                return
            try:
                self.call_from_thread(self._write_output, text)
            except RuntimeError:
                pass

        def _write_output(self, text: str) -> None:
            self._output_lines.extend(str(text).rstrip("\n").splitlines() or [""])
            self._output_scroll = max(0, len(self._output_lines) - OUTPUT_VISIBLE_HEIGHT)
            self._refresh_output_panel()

        def _refresh_output_panel(self) -> None:
            visible_height = OUTPUT_VISIBLE_HEIGHT
            max_scroll = max(0, len(self._output_lines) - visible_height)
            self._output_scroll = max(0, min(self._output_scroll, max_scroll))
            visible = self._output_lines[self._output_scroll : self._output_scroll + visible_height]
            clipped = [self._clip_output_line(line) for line in visible]
            self.query_one("#output-text", Static).update("\n".join(clipped))

        def _clip_output_line(self, line: str) -> str:
            clean = str(line).replace("\t", "    ")
            if len(clean) <= OUTPUT_TEXT_WIDTH:
                return clean
            return clean[: max(0, OUTPUT_TEXT_WIDTH - 1)] + "…"

        def _selected_rgb_color(self) -> str:
            color_key = rgb_target_color_key(self._selected_rgb_target)
            return self.palette[color_key or "background"]

        def _apply_rgb_target_color(self, target_id: str, color: str) -> None:
            if target_id == "background":
                self.palette["background"] = color
            elif target_id == "panel":
                self.palette["panel"] = color
                self.palette["outputPanel"] = color
            elif target_id == "menuLabelText":
                self.palette["menuLabelText"] = color
            save_tui_palette(self.palette, root_dir=self.root_dir)
            self._apply_palette()
            self._refresh_layout(force=True)

        def _open_native_rgb_picker(self, target_id: str) -> None:
            self._selected_rgb_target = target_id
            target_label = rgb_target_label(target_id)
            next_color = choose_native_rgb_color(self._selected_rgb_color(), title=f"OCLAY {target_label}")
            if next_color is None:
                self._inline_message = f"{target_label} color unchanged."
                self._refresh_layout(force=True)
                return
            self._inline_message = f"{target_label} set to {next_color}."
            self._apply_rgb_target_color(target_id, next_color)

        def _save_rgb_preset(self) -> None:
            preset_dir = tui_color_presets_dir(root_dir=self.root_dir)
            selected = choose_tui_preset_save_path(preset_dir)
            if selected is None:
                self._inline_message = "RGB preset save canceled."
                self._refresh_layout(force=True)
                return
            path = keep_tui_preset_path_in_directory(selected, preset_dir)
            try:
                saved_path = save_tui_color_preset(self.palette, path)
            except OSError:
                self._inline_message = "Could not save RGB preset."
                self._refresh_layout(force=True)
                return
            self._inline_message = f"Saved RGB preset: {saved_path.stem}."
            self._refresh_layout(force=True)

        def _load_rgb_preset(self) -> None:
            preset_dir = tui_color_presets_dir(root_dir=self.root_dir)
            selected = choose_tui_preset_load_path(preset_dir)
            if selected is None:
                self._inline_message = "RGB preset load canceled."
                self._refresh_layout(force=True)
                return
            if not _path_inside_directory(selected, preset_dir):
                self._inline_message = "Pick a preset from the TUI presets folder."
                self._refresh_layout(force=True)
                return
            try:
                preset = load_tui_color_preset(selected)
            except ValueError as exc:
                self._inline_message = str(exc)
                self._refresh_layout(force=True)
                return
            self.palette.update(preset)
            self.palette["outputPanel"] = self.palette["panel"]
            save_tui_palette(self.palette, root_dir=self.root_dir)
            self._apply_palette()
            self._inline_message = f"Loaded RGB preset: {selected.stem}."
            self._refresh_layout(force=True)

        def _open_page(self, action: TuiAction) -> None:
            self._active_action = action
            self._page_result = ""
            self._output_lines = []
            self._output_scroll = 0
            if action.action_id == "rgb":
                self.query_one("#rgb-targets", ListView).focus()
            else:
                self.query_one("#output-panel", Container).focus()
            self._refresh_layout(force=True)

        def _command_row_from_widget(self, widget: Any) -> CommandRow | None:
            current = widget
            while current is not None:
                if isinstance(current, CommandRow):
                    return current
                current = getattr(current, "parent", None)
            return None

        def _run_pointer_action(self, action: TuiAction) -> None:
            now = time.monotonic()
            last_action_id, last_at = self._last_pointer_action
            if action.action_id == last_action_id and now - last_at < 0.25:
                return
            self._last_pointer_action = (action.action_id, now)
            self.action_run_action(action.action_id)

        def on_list_view_selected(self, event: ListView.Selected) -> None:
            if isinstance(event.item, RgbTargetRow):
                if event.item.target_id == RGB_PRESET_SAVE_ID:
                    self._save_rgb_preset()
                elif event.item.target_id == RGB_PRESET_LOAD_ID:
                    self._load_rgb_preset()
                else:
                    self._open_native_rgb_picker(event.item.target_id)
                return
            action = getattr(event.item, "tui_action", None)
            if isinstance(action, TuiAction):
                self._run_pointer_action(action)

        def on_click(self, event: events.Click) -> None:
            row = self._command_row_from_widget(getattr(event, "widget", None))
            if row is None:
                return
            event.stop()
            self._run_pointer_action(row.tui_action)

        def action_back(self) -> None:
            if self._active_action is None:
                return
            self._active_action = None
            self._page_result = ""
            self._confirm_clean_until = 0.0
            self._refresh_layout(force=True)

        def action_run_action(self, action_id: str) -> None:
            action = find_tui_action(action_id)
            if action is None:
                self._append_output(f"Unknown action: {action_id}")
                return
            if action.action_id == "exit":
                self.cli.stop_helper()
                self._stop_active_subprocess()
                self.exit(None)
                return
            if action.action_id == "stop":
                self._dispatch_stop_inline()
                return
            if action.action_id == "domain":
                self._toggle_domain_inline()
                return
            if action.action_id == "rgb":
                self._open_page(action)
                return
            if action.action_id in {"review", "build"}:
                self._start_helper_inline(action)
                return
            if action.action_id in REPORT_WINDOW_COMMANDS:
                self._launch_report_window(action)
                return
            if action.action_id == "clean":
                self._start_clean_inline(action)
                return
            if self._busy:
                self._write_output("Another command is already running.")
                return
            self._busy = True
            self.cli.status = action.running_label.lower()
            self._open_page(action)
            self._confirm_clean_until = 0.0
            threading.Thread(target=self._run_action_thread, args=(action,), daemon=True).start()

        def _clean_confirmed(self) -> bool:
            return self._confirm_clean_until > time.monotonic()

        def _start_helper_inline(self, action: TuiAction) -> None:
            if self._busy:
                self._inline_message = "Another command is already running."
                self._refresh_layout(force=True)
                return
            self._active_action = None
            self._inline_message = ""
            self._busy = True
            self.cli.status = "building" if action.action_id == "build" else "reviewing"
            self._refresh_layout(force=True)
            threading.Thread(target=self._start_helper_inline_thread, args=(action,), daemon=True).start()

        def _start_helper_inline_thread(self, action: TuiAction) -> None:
            try:
                self.cli.start_helper("build" if action.action_id == "build" else "review")
            finally:
                self._busy = False
                try:
                    self.call_from_thread(self._refresh_layout, force=True)
                except RuntimeError:
                    pass

        def _start_clean_inline(self, action: TuiAction) -> None:
            if self._busy:
                self._inline_message = "Another command is already running."
                self._refresh_layout(force=True)
                return
            self._active_action = None
            self._inline_message = ""
            self._busy = True
            self.cli.status = "cleaning cache"
            self._refresh_layout(force=True)
            threading.Thread(target=self._clean_inline_thread, args=(action,), daemon=True).start()

        def _clean_inline_thread(self, action: TuiAction) -> None:
            try:
                code = self._run_module_command(["-m", "app.supabase_cache", "--root-dir", str(self.root_dir)])
                self.cli.status = "ready" if code == 0 else "cleanup failed"
                self._inline_message = "Cleanup complete." if code == 0 else "Cleanup failed."
            finally:
                self._busy = False
                self._active_subprocess = None
                try:
                    self.call_from_thread(self._refresh_layout, force=True)
                except RuntimeError:
                    pass

        def _launch_report_window(self, action: TuiAction) -> None:
            """Open a Trainer/Honest/Profitable report in its own console window.

            The TUI stays on the menu; only the status reflects that a report is
            running. The window is kept open (cmd /k) so the user reads it at
            full size and closes it whenever; status returns to ready then.
            """
            command, status = REPORT_WINDOW_COMMANDS[action.action_id]
            self._open_report_windows += 1
            self._active_action = None
            self.cli.status = status
            self._inline_message = f"{action.label} opened in a new window."
            self._refresh_layout(force=True)
            threading.Thread(
                target=self._report_window_thread, args=(action, command, status), daemon=True
            ).start()

        def _report_window_thread(self, action: TuiAction, command: str, status: str) -> None:
            python_exe = self.root_dir / ".venv" / "Scripts" / "python.exe"
            new_console = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
            try:
                process = subprocess.Popen(
                    ["cmd", "/k", str(python_exe), "-m", "app.learning_cli", command, "--pretty"],
                    cwd=str(self.root_dir),
                    creationflags=new_console,
                )
                process.wait()
            except Exception as exc:  # pragma: no cover - defensive UI boundary.
                self._inline_message = f"{action.label} could not open: {exc}"
            finally:
                self._open_report_windows = max(0, self._open_report_windows - 1)
                if self._open_report_windows == 0 and self.cli.status == status:
                    self.cli.status = "ready"
                self._inline_message = f"{action.label}: done."
                try:
                    self.call_from_thread(self._refresh_layout, force=True)
                except RuntimeError:
                    pass

        def _run_action_thread(self, action: TuiAction) -> None:
            failed = False
            try:
                self._dispatch_cli_action(action)
            except Exception as exc:  # pragma: no cover - defensive UI boundary.
                self._append_output(f"{action.label} failed: {exc}")
                self.cli.status = "error"
                failed = True
            finally:
                if self._stop_requested:
                    self.cli.status = "ready"
                    failed = False
                if action.action_id != "rgb":
                    status_text = str(self.cli.status or "").lower()
                    self._page_result = "failed" if failed or "failed" in status_text or "error" in status_text else "done"
                self._busy = False
                self._active_subprocess = None
                self._stop_requested = False
                try:
                    self.call_from_thread(self._refresh_layout, force=True)
                except RuntimeError:
                    pass

        def _run_module_command(self, args: list[str]) -> int:
            python_exe = self.root_dir / ".venv" / "Scripts" / "python.exe"
            self._active_subprocess = subprocess.Popen(
                [str(python_exe), *args],
                cwd=self.root_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            assert self._active_subprocess.stdout is not None
            for line in self._active_subprocess.stdout:
                self._append_output(line.rstrip("\n"))
            return int(self._active_subprocess.wait())

        def _run_module_command_capture(self, args: list[str]) -> tuple[int, str]:
            python_exe = self.root_dir / ".venv" / "Scripts" / "python.exe"
            self._active_subprocess = subprocess.Popen(
                [str(python_exe), *args],
                cwd=self.root_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            assert self._active_subprocess.stdout is not None
            output_lines = [line.rstrip("\n") for line in self._active_subprocess.stdout]
            return int(self._active_subprocess.wait()), "\n".join(output_lines)

        def _dispatch_cli_action(self, action: TuiAction) -> None:
            if action.action_id == "review":
                self.cli.start_helper("review")
            elif action.action_id == "build":
                self.cli.start_helper("build")
            elif action.action_id == "clean":
                self.cli.status = "cleaning cache"
                code = self._run_module_command(["-m", "app.supabase_cache", "--root-dir", str(self.root_dir)])
                self.cli.status = "ready" if code == 0 else "cleanup failed"
            elif action.action_id == "domain":
                self.cli.toggle_stake_site()
            else:
                self._append_output(f"No handler for {action.label}.")

        def _dispatch_stop(self) -> None:
            stopped = False
            if self.cli.process and self.cli.process.poll() is None:
                self.cli.stop_helper()
                stopped = True
            if self._stop_active_subprocess():
                stopped = True
            if stopped:
                self._stop_requested = True
                self._busy = False
                self.cli.status = "ready"
                self._append_output("Stopped active task.")
            else:
                self._append_output("No active task to stop.")
            self._refresh_layout(force=True)

        def _dispatch_stop_inline(self) -> None:
            self._active_action = None
            self._setup_state = "stopping"
            self._inline_message = "Stopping active task..."
            self._refresh_layout(force=True)
            threading.Thread(target=self._stop_inline_thread, daemon=True).start()

        def _stop_inline_thread(self) -> None:
            stopped = False
            if self.cli.process and self.cli.process.poll() is None:
                self.cli.stop_helper()
                stopped = True
            if self._stop_active_subprocess():
                stopped = True
            self._busy = False
            self.cli.status = "ready"
            self._setup_state = "ready"
            self._inline_message = "Stopped active task." if stopped else "No active task to stop."
            try:
                self.call_from_thread(self._refresh_layout, force=True)
            except RuntimeError:
                pass

        def _toggle_domain_inline(self) -> None:
            target = "bet" if self.cli.stake_site == "com" else "com"
            self.cli.set_stake_site(target, announce=False)
            profile = stake_site_profile(self.cli.stake_site, root_dir=self.root_dir)
            self._inline_message = f"Stake site set to {profile['label']}."
            self._refresh_layout(force=True)

        def _stop_active_subprocess(self) -> bool:
            process = self._active_subprocess
            if process is None or process.poll() is not None:
                return False
            process.terminate()
            try:
                process.wait(timeout=3)
            except Exception:
                process.kill()
            return True

        def on_mouse_scroll_up(self, event: events.MouseScrollUp) -> None:
            self._scroll_active_panel(event, -3)

        def on_mouse_scroll_down(self, event: events.MouseScrollDown) -> None:
            self._scroll_active_panel(event, 3)

        def _scroll_active_panel(self, event: Any, y: int) -> None:
            if self._active_action is None:
                return
            if hasattr(event, "stop"):
                event.stop()
            if self._active_action.action_id == "rgb":
                return
            max_scroll = max(0, len(self._output_lines) - OUTPUT_VISIBLE_HEIGHT)
            self._output_scroll = max(0, min(self._output_scroll + y, max_scroll))
            self._refresh_output_panel()
            self._refresh_layout(force=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Oclay Grok-style helper TUI.")
    parser.add_argument("--check", action="store_true", help="Report TUI dependency status.")
    parser.add_argument("--dump-actions", action="store_true", help="Print available TUI actions.")
    args = parser.parse_args(argv)

    if args.check:
        status = textual_dependency_status()
        print(f"textual: {'available' if status['available'] else 'missing'}")
        if status["error"]:
            print(status["error"])
        return 0 if status["available"] else 1

    if args.dump_actions:
        for action in TUI_ACTIONS:
            print(format_tui_action_row(action))
        return 0

    if not TEXTUAL_AVAILABLE:
        print("Textual is not installed. Run:")
        print("  .\\.tools\\uv\\uv.exe pip install -r requirements-local.txt")
        if TEXTUAL_IMPORT_ERROR:
            print(f"Reason: {TEXTUAL_IMPORT_ERROR}")
        return 1

    OclayTui().run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
