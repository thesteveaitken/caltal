# CalTal roadmap

Suggested order. Items 1 and 2 are independent of each other and of everything after them.

## 0. Housekeeping (do first)
Found in the public-repo review. These are dashboard steps, not code.
- [ ] **Archive the old Apps Script deployment** (Deploy > Manage deployments > Archive). Two old web app URLs are in the public git history and work like passwords for the old sheet. Then delete the local `AppsScript.gs`.
- [ ] **Disable Supabase Email sign-in** (Authentication > Sign In / Providers > Email). It is on by default, and the publishable key is public, so anyone could sign up by email directly. Re-enable it when adding magic links. Also check that anonymous sign-ins are off.
- [ ] **Test data isolation with a second Google account** (must be on the consent screen's test-user list). It should see the standard foods but none of your foods or log entries. Also try querying another user's rows from the browser console: it should return nothing.
- [ ] **Check the live site** (https://thesteveaitken.github.io/caltal/): sign in, and confirm the imported history and foods appear.
- [ ] Optional: switch git commits to your GitHub noreply email (GitHub Settings > Emails). The Gmail address is visible on every commit. This only affects new commits.
- [ ] Optional: add a license if you want others to be able to reuse the code. With none, all rights are reserved.

## 1. Logo and desktop layout (done)
- Show the logo in the header and on the sign-in screen. `caltal-icon.png` is not in the repo yet and needs committing (or inlining like the favicon).
- Desktop (about 900px and up): widen the page to roughly 1100px and move the Today/History tabs into the header.
  - Left column: totals and "Logged Today".
  - Right column: food search and Add.
  - History or trends: a full-width page.
- Sign out already exists (bottom of History). Move it into the header menu on desktop.

## 2. Tracking additions and Trends page
Design agreed in conversation. Do the schema and logging first, then the charts.

### 2a. Schema and logging
Database changes, so edit `supabase/schema.sql` (re-runnable) and run it in the SQL editor.
- `log_entries.eaten_at timestamptz` (nullable). Defaults to now in the log sheet and is editable for backfilling. Imported history stays null; the day view ignores null rows. (`created_at` is insert time, so it can't be used.)
- `foods.alcohol` and `log_entries.alcohol`: standard drinks per serving. Values for seeded drinks are in `supabase/seed_drinks.sql` (run).
- `foods.fluid_ml` and `log_entries.fluid_ml`: plain water is a 0-calorie food ("Water (250 ml)"). Coffee, Gatorade and juice get their own values; alcohol stays 0. Drinks with no value count as 0. Add a quick-add for water.
- Goals: one row per user with calorie and protein targets (RLS, own row only).
- Extend `daily_totals` with alcohol and fluid.
- Supplements (for example 10g creatine) are 0-calorie foods that are favourited. No schema change.
- Skipped on purpose: fibre, sugar, sodium (data entry cost), steps, sleep, mood.

**Status (2026-11-08):** the database side is done. `schema.sql` and `seed_drinks.sql` have been run in Supabase and committed. The app code does not use any of the new columns yet, so the live site is unchanged.

**Next: app changes for 2a, in this order.** All in `index.html`. Update `CLAUDE.md` and tick items off here in the same commit as each change.
1. **(Done) Eaten-at time on the log sheet.** Time is picked with a stepper: `(−) [editable time] (+)` in 30 minute steps. Defaults to now when logging today and blank for past days (stored as null). Each entry has a copy-icon button ("log again") that copies it as a new row at the current time. One-off cleanup: `supabase/backfill_eaten_at.sql` (run). Entries show the time. One-offs get the current time when logged for today. Also done: entries now copy `alcohol` and `fluid_ml` from the food. **Original spec:** Add a time field that defaults to now and is editable (for backfilling past days). Save it as `eaten_at`. For a past date, combine the chosen date with the time. Entries from before this change keep `eaten_at` null.
2. **Water quick-add.** (Log-again already covers repeat servings; group water rows in the list later if they clutter.) A one-tap button on Today that logs "Water (250 ml)" (a standard food, already seeded) with `eaten_at` = now. Check that the log insert copies `alcohol` and `fluid_ml` from the food, times quantity, the same way the macros are totalled.
3. **Alcohol and fluid fields** on the add/edit food form (private foods). Existing private foods such as "Coffee with milk" have 0 fluid until edited by hand.
4. **Goals setting.** A simple form for calorie and protein targets (one row in `goals`, upsert on `user_id`), probably reachable from the header menu. Then use the goals as the denominators for the totals bars.
5. Optional: show fluid and alcohol totals for the day on Today.

Checks after each step: load the app, log an entry, and confirm the row in the Supabase table editor has the expected columns. Remember the supabase-js rule about calling other methods inside `onAuthStateChange`.

### 2b. Trends page (replaces History)
- A Day / Week / Month toggle. Tapping a day opens it in Today.
- **Day:** cumulative intake through the day (step line) with an average-day line overlaid. Uses `eaten_at`.
- **Week and month:** daily calories and macros, a 7-day rolling average and a goal line. Days with no entries are gaps, not zeros. Draw a partly logged day (such as today) hollow so it doesn't skew the trend.
- Below the main chart: fluids and alcohol as small charts on the same time axis.
- Library: a pinned Chart.js from a CDN, to keep the no-build rule.

## 3. Guest mode
- A signed-out user can log foods. Entries live in `localStorage`, not memory, because Google sign-in redirects away and back and reloads the page.
- After sign-in, insert the local entries into the database and clear the local copy.
- Show a banner or similar: sign in to save your macro history. Losing guest data in a new session is acceptable.
- Needs a local version of the data layer beside the Supabase one.
- Needs RLS to allow reading standard foods without signing in.
- Adding a custom food could require an account, as a natural sign-in prompt.
- Catch: the Google consent screen in Testing mode blocks anyone not on the test-user list from creating an account. Publishing the consent screen removes that limit.

## 4. Weight (later, needs more thinking)
- A `daily_metrics` table, one row per user per day, nullable columns.
- Store in one unit and add an easy lbs/kg toggle (lbs by default).
- Chart with a 7-day moving average, since daily weight is noisy.
- One-off import of the long history from Apple Health (export is XML), as a separate script like `scripts/migrate_from_sheet.py`.

