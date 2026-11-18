#!/usr/bin/env python3
"""
Put rows from a backup (made by scripts/backup.py) back into CalTal.

Usage:
    python3 scripts/restore_backup.py                      dry run, newest backup
    python3 scripts/restore_backup.py FILE                 dry run, that backup
    python3 scripts/restore_backup.py FILE --apply         do it

Options:
    --table log_entries      only this table (repeatable)
    --user <uuid>            only this person's rows (and their own foods)
    --overwrite              also set rows that still exist but differ back to
                             the backup's values (without it, existing rows are
                             never touched)

By default it only adds rows that are missing: it never deletes anything, and
never changes a row that is still there unless you pass --overwrite. So it is
safe to run twice. The dry run says, per table, how many rows are missing and
how many differ.

Rows belonging to a sign-in account that no longer exists are skipped (they
would break the foreign key); the dry run lists them. Standard foods
(owner_id null) belong to nobody, so --user leaves them out.

Needs scripts/.env with SUPABASE_URL and SUPABASE_SECRET_KEY, like backup.py.
Standard library only. Python 3.9+.
"""

import argparse
import json
import sys
from pathlib import Path

from backup import TABLES, Supabase, backup_dir, backups_in, load_env

BATCH = 500


def key_of(row, pk):
    return tuple(str(row[c]) for c in pk)


def owner_of(table, row):
    if table == "foods":
        return row.get("owner_id")
    return row.get("user_id")


def same(a, b):
    """Equal as values (numbers compare as numbers, so 1 and 1.0 match)."""
    for k, v in a.items():
        w = b.get(k)
        if isinstance(v, (int, float)) and isinstance(w, (int, float)):
            if float(v) != float(w):
                return False
        elif v != w:
            return False
    return True


def write(sb, table, rows, overwrite):
    """Insert (or upsert) in batches; on a failing batch, retry row by row so one bad row is named, not fatal."""
    pk = ",".join(TABLES[table])
    prefer = "return=minimal," + ("resolution=merge-duplicates" if overwrite else "resolution=ignore-duplicates")
    path = f"/rest/v1/{table}?on_conflict={pk}"
    done, failed = 0, []
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        try:
            sb.request("POST", path, batch, prefer=prefer)
            done += len(batch)
        except RuntimeError:
            for row in batch:
                try:
                    sb.request("POST", path, [row], prefer=prefer)
                    done += 1
                except RuntimeError as e:
                    failed.append((key_of(row, TABLES[table]), str(e)))
    return done, failed


def main():
    ap = argparse.ArgumentParser(description="Restore CalTal rows from a backup (dry run unless --apply).")
    ap.add_argument("file", nargs="?", type=Path, help="backup file (default: the newest in the backup folder)")
    ap.add_argument("--dir", help="backup folder to look in when no file is given")
    ap.add_argument("--table", action="append", choices=list(TABLES), help="only this table (repeatable)")
    ap.add_argument("--user", help="only this user id's rows")
    ap.add_argument("--overwrite", action="store_true", help="also reset rows that differ from the backup")
    ap.add_argument("--apply", action="store_true", help="write to the database (default is a dry run)")
    args = ap.parse_args()
    load_env()

    path = args.file
    if path is None:
        found = backups_in(backup_dir(args.dir))
        if not found:
            sys.exit(f"No backups in {backup_dir(args.dir)}.")
        path = found[-1]
    backup = json.loads(path.read_text())
    if backup.get("caltal_backup") != 1:
        sys.exit(f"{path} is not a CalTal backup.")

    sb = Supabase()
    if backup.get("project") != sb.url:
        print(f"Warning: this backup came from {backup.get('project')}, and scripts/.env points at {sb.url}.")
    print(f"{'Restoring' if args.apply else 'Dry run'} from {path.name} (made {backup['created_at']})")
    if args.overwrite:
        print("  --overwrite: rows that differ will be set back to the backup's values.")

    live_users = {u["id"] for u in sb.users()}
    names = {u["id"]: u.get("email") or u["id"] for u in backup.get("users", [])}
    gone = {}
    total_missing = total_differ = 0
    failures = []

    for table, pk in TABLES.items():
        if args.table and table not in args.table:
            continue
        rows = backup["tables"].get(table, [])
        if args.user:
            rows = [r for r in rows if owner_of(table, r) == args.user]
        usable = []
        for r in rows:
            owner = owner_of(table, r)
            if owner is not None and owner not in live_users:
                gone[owner] = gone.get(owner, 0) + 1
            else:
                usable.append(r)

        live = {key_of(r, pk): r for r in sb.all_rows(table)}
        missing = [r for r in usable if key_of(r, pk) not in live]
        differ = [r for r in usable if key_of(r, pk) in live and not same(r, live[key_of(r, pk)])]
        total_missing += len(missing)
        total_differ += len(differ)
        line = f"  {table:<14} {len(usable):>5} in backup, {len(missing):>5} missing, {len(differ):>5} differ"
        if not args.apply:
            print(line)
            continue
        to_write = missing + (differ if args.overwrite else [])
        if to_write:
            done, failed = write(sb, table, to_write, args.overwrite)
            failures += [(table, k, e) for k, e in failed]
            line += f"  -> wrote {done}" + (f", {len(failed)} failed" if failed else "")
        print(line)

    for uid, n in gone.items():
        print(f"  Skipped {n} rows of {names.get(uid, uid)}: that sign-in account no longer exists.")
    for table, k, e in failures:
        print(f"  Failed {table} {k}: {e}")
    if not args.apply:
        if total_missing or (total_differ and args.overwrite):
            print("Nothing written. Add --apply to restore" + (" and overwrite." if args.overwrite else " the missing rows."))
        else:
            print("Nothing to restore." + (" (Rows that differ are left alone unless you pass --overwrite.)" if total_differ else ""))
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
