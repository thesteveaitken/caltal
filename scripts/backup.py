#!/usr/bin/env python3
"""
Back up every CalTal table to one dated JSON file, outside the repo.

Usage:
    python3 scripts/backup.py                 back up now
    python3 scripts/backup.py --schedule      run it weekly (macOS launchd), and back up now
    python3 scripts/backup.py --unschedule    stop the weekly run

Needs scripts/.env (gitignored), as for the other scripts:
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_SECRET_KEY=sb_secret_...
Optional: CALTAL_BACKUP_DIR=/some/folder (or --dir). The default is a folder
called CalTal_Backups next to the repo folder, so backups are never inside it.

What it saves: every row of every table (all users: the secret key bypasses
row-level security), plus the sign-in accounts (id, email, name, dates) so a
user id can be matched to a person. daily_totals is a view and is rebuilt
from log_entries, so it is not saved. Files are readable by you only (0600),
and the newest --keep files (default 12) are kept; older ones are deleted.

Put rows back with scripts/restore_backup.py (dry run by default).

The weekly run (Sunday 10:00, or when the Mac next wakes if it was asleep)
writes to backup.log in the backup folder and shows a macOS notification
if it fails.

The secret key bypasses row-level security. Never commit it.
Standard library only; no pip install needed. Python 3.9+.
"""

import argparse
import json
import os
import plistlib
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DEFAULT_DIR = REPO.parent / "CalTal_Backups"
FILE_PREFIX = "caltal-backup-"
LABEL = "app.caltal.backup"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"

# Every table, in an order that restores cleanly (a row's foreign keys point
# at tables earlier in the list), with its primary key columns.
TABLES = {
    "admins":        ["user_id"],
    "foods":         ["id"],
    "favourites":    ["user_id", "food_id"],
    "log_entries":   ["id"],
    "goals":         ["user_id"],
    "quick_adds":    ["user_id", "slot"],
    "profiles":      ["user_id"],
    "daily_metrics": ["user_id", "date"],
    "sync_keys":     ["user_id"],
}
PAGE = 1000


def load_env() -> None:
    path = HERE / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


class Supabase:
    def __init__(self):
        load_env()
        url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SECRET_KEY", "")
        if not url or not key:
            raise SystemExit("scripts/.env needs SUPABASE_URL and SUPABASE_SECRET_KEY.")
        if key.startswith("sb_publishable_"):
            raise SystemExit("That is the publishable key. Backups need the secret key (sb_secret_...).")
        self.url = url
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):  # legacy service_role JWT
            self.headers["Authorization"] = f"Bearer {key}"

    def request(self, method, path, body=None, prefer=None):
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Supabase {method} {path.split('?')[0]} failed: {e.code} {e.read().decode()[:300]}")

    def all_rows(self, table, select="*"):
        """Every row of a table, paged in primary-key order so no row is skipped or repeated."""
        order = ",".join(TABLES[table])
        rows, offset = [], 0
        while True:
            page = self.request("GET", f"/rest/v1/{table}?select={select}&order={order}&limit={PAGE}&offset={offset}")
            rows.extend(page)
            if len(page) < PAGE:
                return rows
            offset += PAGE

    def users(self):
        out, page = [], 1
        while True:
            data = self.request("GET", f"/auth/v1/admin/users?page={page}&per_page=200")
            batch = data.get("users", []) if isinstance(data, dict) else data
            for u in batch:
                meta = u.get("user_metadata") or {}
                out.append({
                    "id": u["id"],
                    "email": u.get("email"),
                    "name": meta.get("full_name") or meta.get("name"),
                    "created_at": u.get("created_at"),
                    "last_sign_in_at": u.get("last_sign_in_at"),
                })
            if len(batch) < 200:
                return out
            page += 1


def backup_dir(arg):
    return Path(arg or os.environ.get("CALTAL_BACKUP_DIR") or DEFAULT_DIR).expanduser()


def backups_in(folder: Path):
    """Backup files in a folder, oldest first (the names sort by date)."""
    return sorted(folder.glob(f"{FILE_PREFIX}*.json"))


def run_backup(folder: Path, keep: int) -> Path:
    sb = Supabase()
    started = datetime.now().astimezone()
    data = {
        "caltal_backup": 1,
        "created_at": started.isoformat(timespec="seconds"),
        "project": sb.url,
        "users": sb.users(),
        "tables": {t: sb.all_rows(t) for t in TABLES},
    }
    data["counts"] = {t: len(rows) for t, rows in data["tables"].items()}
    data["counts"]["users"] = len(data["users"])

    folder.mkdir(parents=True, exist_ok=True)
    os.chmod(folder, 0o700)
    previous = backups_in(folder)
    out = folder / f"{FILE_PREFIX}{started:%Y-%m-%d-%H%M%S}.json"
    tmp = out.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=1, sort_keys=True)
    tmp.replace(out)  # all or nothing: a half-written file never looks like a backup

    print(f"Saved {out}")
    print("  " + ", ".join(f"{t} {n}" for t, n in data["counts"].items()))
    if previous:
        try:
            before = json.loads(previous[-1].read_text())["counts"]
            for t, n in data["counts"].items():
                if before.get(t, 0) > 0 and n < before[t]:
                    print(f"  Note: {t} has {before[t] - n} fewer rows than the last backup ({previous[-1].name}).")
        except (OSError, ValueError, KeyError):
            pass

    if keep > 0:
        for old in backups_in(folder)[:-keep]:
            old.unlink()
            print(f"  Removed old backup {old.name}")
    return out


def notify(message: str) -> None:
    script = f'display notification {json.dumps(message)} with title "CalTal backup failed"'
    subprocess.run(["osascript", "-e", script], check=False)


def schedule(folder: Path, keep: int) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    os.chmod(folder, 0o700)
    log = str(folder / "backup.log")
    plist = {
        "Label": LABEL,
        # /usr/bin/python3 is a stable stub; sys.executable can be a path inside Xcode that moves on updates
        "ProgramArguments": ["/usr/bin/python3" if Path("/usr/bin/python3").exists() else sys.executable,
                             str(Path(__file__).resolve()),
                             "--dir", str(folder), "--keep", str(keep), "--from-launchd"],
        "StartCalendarInterval": {"Weekday": 0, "Hour": 10, "Minute": 0},
        "StandardOutPath": log,
        "StandardErrorPath": log,
    }
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    unschedule(quiet=True)
    with PLIST.open("wb") as f:
        plistlib.dump(plist, f)
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootstrap", domain, str(PLIST)], check=True)
    print(f"Weekly backup scheduled: Sundays at 10:00 (or when the Mac next wakes), into {folder}")
    print(f"  Job file: {PLIST}. Log: {log}")


def unschedule(quiet=False) -> None:
    if PLIST.exists():
        subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}", str(PLIST)],
                       check=False, capture_output=True)
        PLIST.unlink()
        if not quiet:
            print("Weekly backup stopped.")
    elif not quiet:
        print("No weekly backup was scheduled.")


def main():
    ap = argparse.ArgumentParser(description="Back up every CalTal table to a dated JSON file.")
    ap.add_argument("--dir", help=f"backup folder (default: CALTAL_BACKUP_DIR, else {DEFAULT_DIR})")
    ap.add_argument("--keep", type=int, default=12, help="how many backups to keep (0 keeps all; default 12)")
    ap.add_argument("--schedule", action="store_true", help="run weekly with launchd, and back up now")
    ap.add_argument("--unschedule", action="store_true", help="stop the weekly run")
    ap.add_argument("--from-launchd", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args()
    load_env()
    folder = backup_dir(args.dir)

    if args.unschedule:
        unschedule()
        return
    if args.schedule:
        schedule(folder, args.keep)

    if args.from_launchd:
        print(f"--- {datetime.now():%Y-%m-%d %H:%M}")
    try:
        run_backup(folder, args.keep)
    except (RuntimeError, OSError, SystemExit) as e:
        print(f"Backup failed: {e}", file=sys.stderr)
        if args.from_launchd:
            notify(str(e)[:120])
        sys.exit(1)


if __name__ == "__main__":
    main()
