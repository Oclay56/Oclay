"""Local-only cleanup: prune the SQLite UI-job queue and rebuildable caches.

Everything here is local. It keeps the on-disk footprint small by:

- Pruning finished rows from the local UI-job queue (the message bus between the
  API and the Stake helper), and
- Deleting Chrome's rebuildable caches (HTTP/GPU/shader/service-worker caches)
  under the Stake browser profiles, which are the only things that grow without
  bound. Cookies, local storage, sessions, and profile identity are left alone.

No network or cloud service is touched.
"""

from __future__ import annotations

import argparse
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .local_ui_bridge import LocalSqliteJobStore


@dataclass(frozen=True)
class LocalCleanupTarget:
    name: str
    relative_path: str


CHROME_USER_DATA_DIRS = {
    "stake.com": "data/chrome-stake-ui",
    "stake.bet": "data/chrome-stake-ui-bet",
}
CHROME_PROFILE_DIRS = ("Default", "Profile 1", "Profile 2", "Profile 3")
CHROME_PROFILE_CACHE_TARGETS = [
    ("HTTP cache", "Cache"),
    ("code cache", "Code Cache"),
    ("GPU cache", "GPUCache"),
    ("Dawn graphite cache", "DawnGraphiteCache"),
    ("Dawn WebGPU cache", "DawnWebGPUCache"),
    ("service worker cache", "Service Worker/CacheStorage"),
    ("service worker script cache", "Service Worker/ScriptCache"),
    ("blob cache", "blob_storage"),
]
CHROME_ROOT_CACHE_TARGETS = [
    ("profile GPU persistent cache", "GPUPersistentCache"),
    ("profile shader cache", "ShaderCache"),
    ("profile graph shader cache", "GrShaderCache"),
    ("browser metrics", "BrowserMetrics"),
    ("browser metrics file", "BrowserMetrics-spare.pma"),
    ("crash metrics file", "CrashpadMetrics-active.pma"),
    ("crash reports", "Crashpad/reports"),
    ("crash attachments", "Crashpad/attachments"),
    ("component CRX cache", "component_crx_cache"),
    ("extension CRX cache", "extensions_crx_cache"),
]


def chrome_cleanup_targets() -> list[LocalCleanupTarget]:
    targets: list[LocalCleanupTarget] = []
    for domain, user_data_dir in CHROME_USER_DATA_DIRS.items():
        for profile_dir in CHROME_PROFILE_DIRS:
            for name, relative_path in CHROME_PROFILE_CACHE_TARGETS:
                targets.append(
                    LocalCleanupTarget(
                        f"{domain} Chrome {profile_dir} {name}",
                        f"{user_data_dir}/{profile_dir}/{relative_path}",
                    )
                )
        for name, relative_path in CHROME_ROOT_CACHE_TARGETS:
            targets.append(
                LocalCleanupTarget(
                    f"{domain} Chrome {name}",
                    f"{user_data_dir}/{relative_path}",
                )
            )
    return targets


LOCAL_CLEANUP_TARGETS = [
    LocalCleanupTarget("temporary workspace files", ".tmp"),
    LocalCleanupTarget("pytest cache", ".pytest-cache-local"),
    *chrome_cleanup_targets(),
]


def prune_local_ui_jobs(*, retention_seconds: int | None = None) -> dict[str, Any]:
    """Prune finished rows from the local UI-job queue. Cheap and idempotent."""
    store = LocalSqliteJobStore()
    return store._prune(retention_seconds)


def cleanup_local_cache(
    *,
    root_dir: Path | str,
    dry_run: bool = False,
    targets: list[LocalCleanupTarget] | None = None,
) -> dict[str, Any]:
    root = Path(root_dir).resolve()
    cleanup_targets = targets or LOCAL_CLEANUP_TARGETS
    results: list[dict[str, Any]] = []
    total_files = 0
    total_dirs = 0
    total_bytes = 0
    errors: list[str] = []

    for target in cleanup_targets:
        path = _safe_local_target_path(root, target.relative_path)
        before = _path_stats(path)
        status = "missing"
        if path.exists():
            status = "would_delete" if dry_run else "deleted"
            if not dry_run:
                try:
                    _delete_local_target(path)
                except OSError as exc:
                    status = "failed"
                    errors.append(f"{target.name}: {exc}")
        after_exists = path.exists()
        changed = bool(before["exists"] and not dry_run and not after_exists and status == "deleted")
        if changed or (dry_run and before["exists"]):
            total_files += int(before["files"])
            total_dirs += int(before["dirs"])
            total_bytes += int(before["bytes"])
        results.append(
            {
                "target": target.name,
                "path": str(path),
                "status": status,
                "files": before["files"],
                "dirs": before["dirs"],
                "bytes": before["bytes"],
            }
        )

    return {
        "rootDir": str(root),
        "dryRun": dry_run,
        "deletedFiles": total_files if not dry_run else 0,
        "deletedDirs": total_dirs if not dry_run else 0,
        "bytesFreed": total_bytes if not dry_run else 0,
        "wouldDeleteFiles": total_files if dry_run else 0,
        "wouldDeleteDirs": total_dirs if dry_run else 0,
        "wouldFreeBytes": total_bytes if dry_run else 0,
        "errors": errors,
        "targets": results,
    }


def _safe_local_target_path(root: Path, relative_path: str) -> Path:
    target = (root / relative_path).resolve()
    if target == root or root not in target.parents:
        raise ValueError(f"Refusing to clean path outside workspace: {target}")
    return target


def _path_stats(path: Path) -> dict[str, int | bool]:
    if not path.exists():
        return {"exists": False, "files": 0, "dirs": 0, "bytes": 0}
    if path.is_file():
        return {"exists": True, "files": 1, "dirs": 0, "bytes": path.stat().st_size}
    files = 0
    dirs = 1
    size = 0
    for child in path.rglob("*"):
        try:
            if child.is_dir():
                dirs += 1
            elif child.is_file():
                files += 1
                size += child.stat().st_size
        except OSError:
            continue
    return {"exists": True, "files": files, "dirs": dirs, "bytes": size}


def _delete_local_target(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def _format_bytes(value: Any) -> str:
    try:
        size = float(value)
    except (TypeError, ValueError):
        size = 0.0
    units = ["B", "KB", "MB", "GB"]
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def _load_dotenv(path: Path | None = None) -> None:
    env_path = path or Path.cwd() / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def main() -> int:
    _load_dotenv()
    parser = argparse.ArgumentParser(
        description="Prune the local UI-job queue and rebuildable local cache files.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Report without deleting.")
    parser.add_argument(
        "--root-dir",
        default=str(Path.cwd()),
        help="Workspace root for local cache cleanup.",
    )
    parser.add_argument(
        "--skip-jobs",
        action="store_true",
        help="Skip pruning the local UI-job queue.",
    )
    args = parser.parse_args()

    print("OCLAY local cleanup")
    print("-----------------")
    print(f"Mode: {'dry run' if args.dry_run else 'cleanup'}")
    print()

    if not args.skip_jobs and not args.dry_run:
        jobs = prune_local_ui_jobs()
        print(f"Local UI-job queue: pruned {jobs.get('prunedJobs', 0)} finished rows.")
        print()

    local_result = cleanup_local_cache(root_dir=Path(args.root_dir), dry_run=args.dry_run)
    print("Local rebuildable cache files")
    print(f"Root: {local_result['rootDir']}")
    bytes_label = "Would free" if local_result["dryRun"] else "Freed"
    files = local_result["wouldDeleteFiles"] if local_result["dryRun"] else local_result["deletedFiles"]
    dirs = local_result["wouldDeleteDirs"] if local_result["dryRun"] else local_result["deletedDirs"]
    bytes_count = local_result["wouldFreeBytes"] if local_result["dryRun"] else local_result["bytesFreed"]
    print(f"{bytes_label}: {_format_bytes(bytes_count)} across {files} files and {dirs} folders")
    for target in local_result["targets"]:
        if target["status"] == "missing":
            continue
        print(
            f"- {target['target']}: {target['status']} "
            f"({_format_bytes(target['bytes'])}, {target['files']} files)"
        )
    if local_result["errors"]:
        print("Errors:")
        for error in local_result["errors"]:
            print(f"- {error}")
    print("Kept: Chrome cookies, local storage, sessions, profile identity, and logs.")

    return 1 if local_result["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
