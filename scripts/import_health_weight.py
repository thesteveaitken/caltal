#!/usr/bin/env python3
"""
One-off import of weight history from an Apple Health export into
CalTal's daily_metrics table, under one user.

Usage:
  1. iPhone: Health > profile picture > Export All Health Data. AirDrop the
     export.zip to the Mac. Keep it OUTSIDE the repo (it is personal data).
  2. scripts/.env (gitignored) needs, as for migrate_from_sheet.py:
        SUPABASE_URL=https://xxxx.supabase.co
        SUPABASE_SECRET_KEY=sb_secret_...
        CALTAL_USER_ID=<your user uuid>
  3. Dry run (the default; writes nothing), then the real run:
        python3 scripts/import_health_weight.py ~/Downloads/export.zip
        python3 scripts/import_health_weight.py ~/Downloads/export.zip --apply

  Options:
    --since 2020-01-01 / --until 2025-12-31   limit the date range
    --exclude-source "MyFitnessPal"            drop a source (repeatable;
                                               names as the dry run lists them)

Rules: body-mass records only; each record's date is its local date as
recorded (startDate); several weigh-ins on one day are averaged; weights
outside 20-400 kg are dropped. Rows get source 'import'. Days that already
have a weigh-in in CalTal are left alone (typed or Shortcut entries win),
so re-running is safe.

Undo later: delete from public.daily_metrics where source = 'import';

The secret key bypasses row-level security. Never commit it.
Standard library only; no pip install needed.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

BODY_MASS = "HKQuantityTypeIdentifierBodyMass"
TO_KG = {"kg": 1.0, "lb": 0.45359237, "g": 0.001, "st": 6.35029318}


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def open_export(path: Path):
    """export.zip or an unzipped export.xml, as a binary stream."""
    if path.suffix.lower() == ".zip":
        zf = zipfile.ZipFile(path)
        names = [n for n in zf.namelist() if n.endswith("/export.xml") or n == "export.xml"]
        if not names:
            sys.exit("No export.xml inside that zip.")
        return zf.open(names[0])
    return path.open("rb")


def read_weights(path: Path):
    """Yield (date, kg, source) for every body-mass record, streaming the XML."""
    with open_export(path) as f:
        context = ET.iterparse(f, events=("start", "end"))
        _, root = next(context)
        for event, el in context:
            if event != "end" or el.tag != "Record":
                continue
            if el.get("type") == BODY_MASS:
                unit = (el.get("unit") or "").lower()
                start = el.get("startDate") or ""
                try:
                    value = float(el.get("value"))
                except (TypeError, ValueError):
                    value = None
                if unit in TO_KG and value is not None and len(start) >= 10:
                    yield start[:10], value * TO_KG[unit], el.get("sourceName") or "?"
                else:
                    yield None, None, f"unreadable (unit {unit!r})"
            root.clear()  # keep memory flat on multi-GB exports


class Supabase:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):  # legacy service_role JWT
            self.headers["Authorization"] = f"Bearer {key}"

    def request(self, method, path, body=None, prefer=None):
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            sys.exit(f"Supabase {method} {path} failed: {e.code} {e.read().decode()}")

    def existing_dates(self, uid):
        dates, offset = set(), 0
        while True:
            page = self.request("GET", f"/daily_metrics?select=date&user_id=eq.{uid}&order=date&limit=1000&offset={offset}")
            dates.update(r["date"] for r in page)
            if len(page) < 1000:
                return dates
            offset += 1000


def main():
    ap = argparse.ArgumentParser(description="Import Apple Health weights into CalTal.")
    ap.add_argument("export", type=Path, help="export.zip (or an unzipped export.xml)")
    ap.add_argument("--since", help="first date to import, YYYY-MM-DD")
    ap.add_argument("--until", help="last date to import, YYYY-MM-DD")
    ap.add_argument("--exclude-source", action="append", default=[], metavar="NAME")
    ap.add_argument("--apply", action="store_true", help="write to Supabase (default is a dry run)")
    args = ap.parse_args()
    if not args.export.exists():
        sys.exit(f"Not found: {args.export}")

    by_source = defaultdict(lambda: [0, None, None])  # source -> [count, first, last]
    by_day = defaultdict(list)
    dropped = defaultdict(int)
    excluded = {s.lower() for s in args.exclude_source}

    print("Reading the export (a big one can take a minute)...")
    for date, kg, source in read_weights(args.export):
        if date is None:
            dropped[source] += 1
            continue
        s = by_source[source]
        s[0] += 1
        s[1] = min(s[1] or date, date)
        s[2] = max(s[2] or date, date)
        if source.lower() in excluded:
            dropped[f"excluded source {source}"] += 1
        elif (args.since and date < args.since) or (args.until and date > args.until):
            dropped["outside --since/--until"] += 1
        elif not 20 <= kg <= 400:
            dropped["outside 20-400 kg"] += 1
        else:
            by_day[date].append(kg)

    print("\nWeight records by source:")
    if not by_source:
        sys.exit("  none found (is this an Apple Health export?)")
    for name, (n, first, last) in sorted(by_source.items(), key=lambda x: -x[1][0]):
        print(f"  {n:6d}  {first} to {last}  {name}")
    for reason, n in dropped.items():
        print(f"  dropped {n}: {reason}")

    days = {d: round(sum(v) / len(v), 3) for d, v in sorted(by_day.items())}
    if not days:
        sys.exit("\nNothing left to import.")
    per_year = defaultdict(int)
    for d in days:
        per_year[d[:4]] += 1
    multi = sum(1 for v in by_day.values() if len(v) > 1)
    print(f"\n{len(days)} days, {min(days)} to {max(days)} ({multi} days averaged from several weigh-ins)")
    print("Days per year: " + ", ".join(f"{y} {n}" for y, n in sorted(per_year.items())))
    lo, hi = min(days.values()), max(days.values())
    print(f"Range: {lo:.1f}-{hi:.1f} kg ({lo / TO_KG['lb']:.1f}-{hi / TO_KG['lb']:.1f} lb)")

    load_env(Path(__file__).with_name(".env"))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    uid = os.environ.get("CALTAL_USER_ID")
    if not (url and key and uid):
        msg = "Set SUPABASE_URL, SUPABASE_SECRET_KEY and CALTAL_USER_ID in scripts/.env"
        if args.apply:
            sys.exit(msg + ".")
        print(f"\n({msg} to compare with what is already in CalTal.)\nDry run: nothing written.")
        return

    db = Supabase(url, key)
    have = db.existing_dates(uid)
    rows = [{"user_id": uid, "date": d, "weight_kg": kg, "source": "import"}
            for d, kg in days.items() if d not in have]
    print(f"\nAlready in CalTal (kept as they are): {len(days) - len(rows)} of these days")
    print(f"To add: {len(rows)} days")

    if not args.apply:
        print("Dry run: nothing written. Add --apply to import.")
        return
    for i in range(0, len(rows), 500):
        db.request("POST", "/daily_metrics?on_conflict=user_id,date", rows[i:i + 500],
                   prefer="resolution=ignore-duplicates,return=minimal")
    print(f"Imported {len(rows)} days.")


if __name__ == "__main__":
    main()
