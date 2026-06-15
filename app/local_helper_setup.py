from __future__ import annotations

import os
from pathlib import Path
from typing import Any


# No external-service credentials are required: the API and helper rendezvous
# through a local SQLite job queue, so the helper runs with zero cloud setup.
REQUIRED_ENV_KEYS: tuple[str, ...] = ()


def check_local_helper_setup(root_dir: Path) -> dict[str, Any]:
    env_values = _read_env_file(root_dir / ".env")
    merged_env = {**env_values, **os.environ}
    python_exe = root_dir / ".venv" / "Scripts" / "python.exe"
    env_path = root_dir / ".env"
    chrome_path = _chrome_path(merged_env)

    checks = [
        _check("Python venv", python_exe.exists(), str(python_exe)),
        _check(".env file", env_path.exists(), str(env_path)),
        *[
            _check(f"{key} configured", bool(str(merged_env.get(key) or "").strip()), key)
            for key in REQUIRED_ENV_KEYS
        ],
        _check(
            "Chrome executable",
            bool(chrome_path),
            str(chrome_path) if chrome_path else "Set AZP_CHROME_PATH if Chrome is not installed normally.",
        ),
    ]

    warnings: list[str] = []
    if not str(merged_env.get("OCLAY_AUTO_CLEANUP_MINUTES") or "").strip():
        warnings.append("OCLAY_AUTO_CLEANUP_MINUTES is not set; defaulting to 60.")

    return {
        "ok": all(item["ok"] for item in checks),
        "checks": checks,
        "warnings": warnings,
    }


def format_setup_report(report: dict[str, Any]) -> str:
    lines = ["Oclay setup check", "-----------------"]
    for item in report.get("checks") or []:
        mark = "OK" if item.get("ok") else "MISSING"
        lines.append(f"[{mark}] {item.get('name')}: {item.get('detail')}")
    warnings = list(report.get("warnings") or [])
    if warnings:
        lines.append("")
        lines.append("Warnings:")
        for warning in warnings:
            lines.append(f"- {warning}")
    lines.append("")
    lines.append("Ready." if report.get("ok") else "Fix missing items before starting the helper.")
    return "\n".join(lines)


def _check(name: str, ok: bool, detail: str) -> dict[str, Any]:
    return {"name": name, "ok": bool(ok), "detail": detail}


def _read_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _chrome_path(env: dict[str, str]) -> Path | None:
    configured = str(env.get("AZP_CHROME_PATH") or "").strip()
    candidates = [
        Path(configured) if configured else None,
        Path(os.environ.get("ProgramFiles", "")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("ProgramFiles(x86)", "")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("LocalAppData", "")) / "Google/Chrome/Application/chrome.exe",
    ]
    for candidate in candidates:
        if candidate and candidate.exists():
            return candidate
    return None
