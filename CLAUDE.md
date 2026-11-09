# CalTal

Personal calorie and macro tracker, shared with a few friends. Not commercial. Mobile-first dark UI.

## Architecture
- **One static `index.html`**: vanilla JS and CSS, no framework, no build step. Keep it that way.
- **Backend is Supabase only**: Postgres, Google sign-in, and row-level security (RLS). The browser calls Supabase directly through `supabase-js` (pinned CDN script). There is no server code.
- **Hosting:** GitHub Pages, from `main` of `thesteveaitken/caltal`. Live at https://thesteveaitken.github.io/caltal/. Project ref `virurqttoukgzrpdsizs`.
- **Schema:** `supabase/schema.sql` (tables, RLS policies, the `daily_totals` view). Keep it safe to re-run (`if not exists`, `or replace`, `drop policy if exists`).
- **Standard foods:** `supabase/seed_foods.sql`. Safe to re-run: existing names are skipped.
- **Old backend:** the Google Sheet and Apps Script (`AppsScript.gs`, local only, never committed). It has been migrated and is being retired.

## Data model decisions
- `foods.owner_id IS NULL` is a **standard food**, readable by every signed-in user. Otherwise the food is private to its owner.
- Only user ids in the `admins` table can write standard foods. Anything added in the app is always private. There is no admin UI: maintain standard foods with SQL or the Supabase table editor.
- **Favourites are per user** (`favourites` table) and can point at standard or private foods.
- Nutrition is **per serving, as described in the food name** ("1 cup cooked rice"). There are no units or gram fields.
- `log_entries` store **totals** (per-serving x quantity) plus a `food_name` snapshot, so editing or deleting a food never changes history. `food_id` is null for one-offs. Quantity steps by 0.5, minimum 0.5.
- History comes from the `daily_totals` view. It has no rows for days with no entries, so empty days are naturally skipped.
- Security lives in RLS, not in the client. Any new table needs RLS enabled and policies written before it is used.

## Rules
- **Keys:** the publishable key (`sb_publishable_...`) is public and lives in `index.html`. The secret key (`sb_secret_...`) must **never** go in `index.html`, the repo, or chat. It is only for `scripts/.env`.
- **Gitignored, never commit:** `scripts/.env`, `*.csv` and `promote.txt`.
- Check `git status` before committing: this repo is public.
- The Google OAuth consent screen is in "Testing" mode, so only listed test users can sign in. Add friends' Gmail addresses under Test users in Google Cloud.
- supabase-js: call other Supabase methods inside `onAuthStateChange` only after a `setTimeout`, to avoid a deadlock.

## Run and deploy
- **Local:** `cd` to the project, run `python3 -m http.server 8000`, open http://localhost:8000. Hard-refresh after edits.
- **Deploy:** commit and push `main`. Pages rebuilds in a minute or two.
- **Database changes:** edit `supabase/schema.sql`, then run the new SQL in the Supabase SQL editor. There are no migrations tooling or tests.
- **One-off import** (already done): `scripts/migrate_from_sheet.py`. It is standard-library Python and the full steps are in `SETUP.md`.

## Redirect URLs (must stay in sync)
- Google client, authorized origins: `https://thesteveaitken.github.io` and `http://localhost:8000`.
- Google client, redirect URI: `https://virurqttoukgzrpdsizs.supabase.co/auth/v1/callback`.
- Supabase Site URL: `https://thesteveaitken.github.io/caltal/`. Redirect URLs also include `http://localhost:8000/**`.

## Where things are
- `index.html`: markup, then CSS, then one `<script>`. State is global variables. Data access goes through the `must()` helper, which turns Supabase `{data, error}` results into exceptions.
- `SETUP.md`: full setup walkthrough for a fresh Supabase project.
- `ROADMAP.md`: planned work.
