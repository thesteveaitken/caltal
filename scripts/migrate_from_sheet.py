#!/usr/bin/env python3
"""
One-off import of the old Google Sheet data into Supabase, under one user.

Usage:
  1. In the Sheet: File > Download > CSV, once on the Foods tab and once on
     the Log tab. Save them as Foods.csv and Log.csv.
  2. Sign in to the new app once with Google so your user exists, then copy
     your user id from Supabase > Authentication > Users.
  3. Create scripts/.env (gitignored) containing:
        SUPABASE_URL=https://xxxx.supabase.co
        SUPABASE_SECRET_KEY=sb_secret_...    (Project Settings > API Keys)
        CALTAL_USER_ID=<your user uuid>
  4. Dry run first, then the real run:
        python3 scripts/migrate_from_sheet.py --foods Foods.csv --log Log.csv --dry-run
        python3 scripts/migrate_from_sheet.py --foods Foods.csv --log Log.csv

  Optional: --promote promote.txt (one food name per line). Those foods are
  inserted as STANDARD foods (visible to all users) instead of private ones.

The secret key bypasses row-level security. Never commit it and never
put it in index.html.

Standard library only; no pip install needed.
"""

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

DATE_FORMATS = ["%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m/%d/%y"]
TIMESTAMP_FORMATS = [
    "%m/%d/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ",
]


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def num(s) -> float:
    try:
        return float(str(s).replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def parse_date(s: str, day_first: bool) -> str:
    s = s.strip()
    fmts = DATE_FORMATS if not day_first else ["%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d/%m/%y"]
    for f in fmts:
        try:
            return datetime.strptime(s, f).date().isoformat()
        except ValueError:
            pass
    raise ValueError(f"Unrecognised date: {s!r} (try --day-first if your sheet is DD/MM)")


def parse_timestamp(s: str, day_first: bool):
    s = (s or "").strip()
    if not s:
        return None
    fmts = TIMESTAMP_FORMATS
    if day_first:
        fmts = ["%d/%m/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M"] + fmts
    for f in fmts:
        try:
            dt = datetime.strptime(s, f)
            if s.endswith("Z"):
                return dt.isoformat() + "+00:00"
            # Sheet timestamps are in the sheet's timezone; assume it matches this machine.
            return dt.astimezone().isoformat()
        except ValueError:
            pass
    print(f"  ! could not parse timestamp {s!r}; using import time", file=sys.stderr)
    return None


def truthy(s) -> bool:
    return str(s).strip().lower() in ("true", "yes", "1", "y", "x", "★")


class Supabase:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": key,
            "Content-Type": "application/json",
        }
        # New sb_secret_... keys aren't JWTs and go in `apikey` only.
        # Legacy service_role keys are JWTs (start with "eyJ") and also need Authorization.
        if key.startswith("eyJ"):
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

    def insert(self, table, rows, chunk=500):
        out = []
        for i in range(0, len(rows), chunk):
            out += self.request("POST", f"/{table}", rows[i:i + chunk], prefer="return=representation") or []
        return out


def read_csv(path: Path):
    with path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    return rows[1:]  # drop header row


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--foods", type=Path, required=True, help="CSV export of the Foods tab")
    ap.add_argument("--log", type=Path, required=True, help="CSV export of the Log tab")
    ap.add_argument("--promote", type=Path, help="text file of food names to import as STANDARD foods")
    ap.add_argument("--day-first", action="store_true", help="dates in the CSV are DD/MM/YYYY")
    ap.add_argument("--dry-run", action="store_true", help="parse and summarise, write nothing")
    ap.add_argument("--force", action="store_true", help="import even if the user already has log entries")
    args = ap.parse_args()

    load_env(Path(__file__).with_name(".env"))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")  # old name still works
    uid = os.environ.get("CALTAL_USER_ID")
    if not (url and key and uid):
        sys.exit("Set SUPABASE_URL, SUPABASE_SECRET_KEY and CALTAL_USER_ID (see scripts/.env.example).")

    promote = set()
    if args.promote:
        promote = {l.strip().lower() for l in args.promote.read_text().splitlines() if l.strip()}

    # ---- Foods: Name | Calories | Protein | Carbs | Fat | Favourite
    foods, favourite_names, seen = [], [], set()
    for r in read_csv(args.foods):
        r += [""] * (6 - len(r))
        name = r[0].strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        foods.append({
            "owner_id": None if name.lower() in promote else uid,
            "name": name,
            "calories": num(r[1]), "protein": num(r[2]), "carbs": num(r[3]), "fat": num(r[4]),
        })
        if truthy(r[5]):
            favourite_names.append(name.lower())

    # ---- Log: Date | Food | Quantity | Calories | Protein | Carbs | Fat | Timestamp
    log = []
    for i, r in enumerate(read_csv(args.log), start=2):
        r += [""] * (8 - len(r))
        if not r[0].strip() and not r[1].strip():
            continue
        entry = {
            "user_id": uid,
            "date": parse_date(r[0], args.day_first),
            "food_name": r[1].strip() or "(unnamed)",
            "quantity": num(r[2]) or 1,
            "calories": num(r[3]), "protein": num(r[4]), "carbs": num(r[5]), "fat": num(r[6]),
        }
        ts = parse_timestamp(r[7], args.day_first)
        if not ts:
            # PostgREST bulk inserts need identical keys on every row, so give
            # entries without a timestamp noon on their own day.
            ts = datetime.strptime(entry["date"], "%Y-%m-%d").replace(hour=12).astimezone().isoformat()
        entry["created_at"] = ts
        log.append(entry)

    n_std = sum(1 for f in foods if f["owner_id"] is None)
    print(f"Foods: {len(foods)} ({len(foods) - n_std} private, {n_std} promoted to standard), "
          f"{len(favourite_names)} favourites")
    print(f"Log:   {len(log)} entries across {len({e['date'] for e in log})} days"
          + (f" ({min(e['date'] for e in log)} → {max(e['date'] for e in log)})" if log else ""))
    missing = promote - {f["name"].lower() for f in foods}
    if missing:
        print(f"  ! promote list names not found in Foods.csv: {sorted(missing)}")

    if args.dry_run:
        print("Dry run: nothing written.")
        return

    sb = Supabase(url, key)

    existing = sb.request("GET", f"/log_entries?select=id&user_id=eq.{uid}&limit=1")
    if existing and not args.force:
        sys.exit("This user already has log entries; re-running would duplicate them. Use --force to override.")

    # Skip foods that already exist (same owner + name), e.g. promoted names already in the seed.
    std_existing = sb.request("GET", "/foods?select=id,name&owner_id=is.null") or []
    own_existing = sb.request("GET", f"/foods?select=id,name&owner_id=eq.{uid}") or []
    std_by_name = {f["name"].lower(): f["id"] for f in std_existing}
    own_by_name = {f["name"].lower(): f["id"] for f in own_existing}

    to_insert = [f for f in foods
                 if f["name"].lower() not in (std_by_name if f["owner_id"] is None else own_by_name)]
    for f in sb.insert("foods", to_insert):
        (std_by_name if f["owner_id"] is None else own_by_name)[f["name"].lower()] = f["id"]
    print(f"Inserted {len(to_insert)} foods ({len(foods) - len(to_insert)} already existed)")

    def food_id_for(name):
        n = name.lower()
        return own_by_name.get(n) or std_by_name.get(n)

    favs = [{"user_id": uid, "food_id": food_id_for(n)} for n in favourite_names if food_id_for(n)]
    if favs:
        sb.request("POST", "/favourites?on_conflict=user_id,food_id", favs,
                   prefer="resolution=ignore-duplicates,return=minimal")
    print(f"Inserted {len(favs)} favourites")

    for e in log:
        e["food_id"] = food_id_for(e["food_name"])
    linked = sum(1 for e in log if e["food_id"])
    sb.insert("log_entries", log)
    print(f"Inserted {len(log)} log entries ({linked} linked to a food, {len(log) - linked} one-offs)")
    print("Done.")


if __name__ == "__main__":
    main()
