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

**Status (2026-11-10):** schema and seeds are all run in Supabase. Live in the app: eaten-at time, log again, water quick-add, profile menu, goals sheet and the goal-based summary. Step 3 is built. Next: an edit-food screen (optional), then item 2b (Trends page).

**App changes for 2a.** All in `index.html`. Update `CLAUDE.md` and tick items off here in the same commit as each change.
1. **(Done) Eaten-at time on the log sheet.** Time is picked with a stepper: `(−) [editable time] (+)` in 30 minute steps. Defaults to now when logging today and blank for past days (stored as null). Each entry has a copy-icon button ("log again") that copies it as a new row at the current time. One-off cleanup: `supabase/backfill_eaten_at.sql` (run). Entries show the time. One-offs get the current time when logged for today. Also done: entries now copy `alcohol` and `fluid_ml` from the food. **Original spec:** Add a time field that defaults to now and is editable (for backfilling past days). Save it as `eaten_at`. For a past date, combine the chosen date with the time. Entries from before this change keep `eaten_at` null.
2. **(Done) Water quick-add.** A "+ Water 250 ml" pill under the totals logs the standard "Water (250 ml)" food at the current time, and the day's fluids show in the summary. (Log-again already covers repeat servings; group water rows in the list later if they clutter.) A one-tap button on Today that logs "Water (250 ml)" (a standard food, already seeded) with `eaten_at` = now. Check that the log insert copies `alcohol` and `fluid_ml` from the food, times quantity, the same way the macros are totalled.
3. **(Built, needs a test) Alcohol, fluid and creatine fields** on the new-food form (Fluid ml, Alcohol std drinks, Creatine g; blank = 0), tucked in a collapsed "Drinks & supplements" section. A dim pencil icon in the log sheet corner (next to the star) (your own foods only) reopens the same form to change a food (built, needs a test); past entries keep their values. Before that, private foods such as "Coffee with milk" still have 0 fluid until changed in the Supabase table editor (or a food edit screen is added). `supabase/backfill_fluids_alcohol.sql` (one-off, run) sets fluid/alcohol on your own foods and copies fluid, alcohol and creatine onto past log entries.
4. **(Built, see 2a-bis) Goals setting.** A simple form for calorie and protein targets (one row in `goals`, upsert on `user_id`), probably reachable from the header menu. Then use the goals as the denominators for the totals bars.
5. (Done, fluids only) Daily summary totals. Alcohol is left for the Trends page.

Checks after each step: load the app, log an entry, and confirm the row in the Supabase table editor has the expected columns. Remember the supabase-js rule about calling other methods inside `onAuthStateChange`.

### 2a-bis. Daily summary and goals design (agreed and built 2026-11-10)
Built: header profile menu (photo or initial; email, Goals, Sign out), Goals sheet (on/off switch plus value per goal; off stores null), summary bars as designed below.
- **Goals:** calories 2,200 (a ceiling), protein 150 g, fluids 3,000 ml, creatine 10 g. No carb or fat goals. The app falls back to calories 2,200, protein 150 and fluids 3,000 when a user has no `goals` row; creatine defaults to off (null = off, hidden from the summary). Set yours to 10 g in the goals form.
- **Schema:** `creatine_g` on `foods` and `log_entries`; `fluid_ml` and `creatine_g` on `goals`; `creatine_g` added to `daily_totals` (in `schema.sql`; `supabase/seed_supplements.sql` adds "Creatine (10 g)" and "Creatine (5 g)"). Both have been run.
- **Summary shows little text; bars carry progress.** Goal numbers are not shown in the summary, only in the goals form.
  - Calories: big number plus a small "N left". The bar warns amber then red past the ceiling.
  - Protein: grams, bar filling toward 150. Carbs and fat: grams only, bars as a share of the day's calories (no goals).
  - Fluids: litres ("1.25 L"), bar toward 3 L, "done" look once reached. This replaces the "Fluids" text beside the water button; the button stays.
  - Creatine: same bar style as the others, shows the logged grams ("10g"), with a check once the goal is reached.
  - Layout: two rows on the same three columns (Protein/Carbs/Fat, then Fluids/Creatine). Calorie bar is 4px like the rest.
  - Alcohol is NOT on the daily summary: it is a trend over time, so it belongs on the Trends page.
- **Later:** a pace tick on each bar (where you'd be by this time of day), using a waking-hours window.

### 2a-ter. Configurable quick-add buttons (built 2026-11-10; needs `schema.sql` run and a test)
**Decided:** 6 slots (3 x 2, 34px tall buttons), 10-character labels, grid directly under the search box (search stays first), with no heading. Editing: a "Quick-add buttons" item in the avatar menu, plus dotted "+ Add" cells that complete a partly filled row (shown at 1, 2, 4 or 5 buttons) and open the editor on the first empty slot. Water (250 ml) is a virtual default for slot 0 until the user saves buttons (clearing every slot brings that default back). The old water-row is removed.
Problem: the water button sits under the summary and pushes "Logged Today" down, especially now that the summary has grown. Idea: move it to the right column, as one of several user-configurable quick-add buttons.
- **Where:** top of the right column, above or below the search box, as a small grid of compact buttons (3 columns, up to 2 rows). The water button moves out of the left column.
- **Search:** typing in the search box hides the quick-add buttons so the results get the space.
- **Configurable:** each button points at a food (standard or the user's own) and has a short label, character limited (about 10) so buttons stay small. Example: the food "1 large chicken breast" with the label "Chkn Brst".
- **Tap = log 1 serving at the current time**, the same as the water button does today (on a past day, no time). Toast confirms.
- **Count:** 6 slots (3 x 2), with unused slots hidden.
- **Defaults:** a new user gets "Water" (the 250 ml water food) in slot 1; the rest are empty.
- **Editing:** an "Edit" link or a pencil next to the grid opens a small sheet: pick a slot, choose a food from the food list, type the label, save. A way to clear a slot.
- **Storage (proposed):** a new `quick_adds` table: `user_id`, `slot` (0-5), `food_id` (references foods, on delete cascade), `label` (max 12 chars), primary key `(user_id, slot)`. Own-row RLS, written in `schema.sql` before the app uses it. Deleting a food removes its button.
- **Mobile:** the right column becomes the "Add food" section under "Logged Today", so the buttons would sit below the log. On mobile the grid sits at the top of the Add food section.
- **Also:** update `CLAUDE.md` (data model and "where things are") and remove the old water-row code.

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

