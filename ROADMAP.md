# CalTal roadmap

## Where we left off (2026-11-13)
Everything below marked built is committed and live. Latest: weight tracking stage 1 (built, not yet live).
**Pick up with:**
1. **(Done)** Guest merge tested with a real sign-in.
2. **Publish the Google consent screen** (Google Cloud, Testing to In production) so friends and employers can sign in; then check sign-in works from an account not on the test list. See section 3, step 6.
3. **Section 0 housekeeping** below (archive the old Apps Script, second-account isolation test).
4. **(Done)** Goals helper (2a-quater), live with the `profiles` table.
5. **(Done)** Creatine card: streak and 4-week grid (2b).
6. **Weight stage 1 (section 4): built, not yet live.** Run the new `daily_metrics` section of `supabase/schema.sql` (it also adds `goals.weight_kg`) before pushing.
7. Then: weight stage 2 (your Apple Health Shortcut), stage 3 (history import), pace tick on the summary bars (2a-bis).

**Maybe later** (not sure they are worth it):
- **Day view on Trends.** Today already shows a day's entries and times, so a one-day chart adds little. If it comes back, make it a pattern over the window instead ("most of your calories land after 7pm"), read from `log_entries.eaten_at`.
Suggested order for the older items below is historical; the list above is current.

## Ledger redesign (done and live 2026-11-11)
UX and brand audit, then a new look: "Ledger" direction, Bar tab variant. Brief and every decision are in `.impeccable.md`; mockups are on the design canvas. Built in passes, each checked in light and dark, phone and desktop:
1. **(Done)** Colours and fonts: light paper base with dark following the device, amber (since unified to the logo amber `#e8a23d` in both themes), crimson for over, Barlow + Barlow Condensed, tally mark drawn in the header.
2. **(Done)** Today: hero number, tally (20 marks to the goal, room for 150%), goal grid, ruled entry rows, remove-with-Undo in the edit sheet, search band pinned above the tab bar on phones, one-line guest strip.
3. **(Done)** Sheets: log sheet ("After this: N cal left/over"), new food ("Save and log 1 serving" primary), one-off, goals, quick-add, profile menu values.
4. **(Done)** Trends: ruled sections, by-day alcohol on 7 days (weekly on 4 weeks), dashed today bar.
5. **(Done)** Accessibility from the audit: pinch-zoom, labels on icon buttons, visible focus, sheet focus handling, landmarks and an h1, reduced motion.
6. **(Done)** Merged into `main` and live.
Later passes:
- **(Done)** Food list with recently logged foods first: "Recent" (up to 8), then favourites, then A-Z, one list with no headings; search keeps that order.
- **(Done)** One brand amber: light mode now uses the logo's `#e8a23d` for every mark and fill, with words in ink and amber underlines on links.
- **(Done)** Chart colour contrast: "short of goal" bars are now a pale body with a dark cap at the value (cap 5.5:1 on paper); the light-mode fat segment, missed creatine rings and switch off-state moved to `#878d95` (3:1). Rejected: darker solid bars (too heavy), outlines (too close to today's dashed bar), hatching (busy on 4 weeks).

## 0. Housekeeping (do first)
Found in the public-repo review. These are dashboard steps, not code.
- [ ] **Archive the old Apps Script deployment** (Deploy > Manage deployments > Archive). Two old web app URLs are in the public git history and work like passwords for the old sheet. Then delete the local `AppsScript.gs`.
- [x] **Disable Supabase Email sign-in** (Authentication > Sign In / Providers > Email). It is on by default, and the publishable key is public, so anyone could sign up by email directly. Re-enable it when adding magic links. Also check that anonymous sign-ins are off.
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

**Status (2026-11-11):** schema and seeds are all run in Supabase. Steps 1-5 of 2a and the edit-food pencil are done and live. Trends steps 1 and 2 are done (see 2b).

**App changes for 2a.** All in `index.html`. Update `CLAUDE.md` and tick items off here in the same commit as each change.
1. **(Done) Eaten-at time on the log sheet.** Time is picked with a stepper: `(−) [editable time] (+)` in 30 minute steps. Defaults to now when logging today and blank for past days (stored as null). Each entry has a copy-icon button ("log again") that copies it as a new row at the current time. One-off cleanup: `supabase/backfill_eaten_at.sql` (run). Entries show the time. One-offs get the current time when logged for today. Also done: entries now copy `alcohol` and `fluid_ml` from the food. **Original spec:** Add a time field that defaults to now and is editable (for backfilling past days). Save it as `eaten_at`. For a past date, combine the chosen date with the time. Entries from before this change keep `eaten_at` null.
2. **(Done) Water quick-add.** A "+ Water 250 ml" pill under the totals logs the standard "Water (250 ml)" food at the current time, and the day's fluids show in the summary. (Log-again already covers repeat servings; group water rows in the list later if they clutter.) A one-tap button on Today that logs "Water (250 ml)" (a standard food, already seeded) with `eaten_at` = now. Check that the log insert copies `alcohol` and `fluid_ml` from the food, times quantity, the same way the macros are totalled.
3. **(Built, needs a test) Alcohol, fluid and creatine fields** on the new-food form (Fluid ml, Alcohol std drinks, Creatine g; blank = 0), tucked in a collapsed "Drinks & supplements" section. A dim pencil icon in the log sheet corner (next to the star) (your own foods only) reopens the same form to change a food (built, needs a test); past entries keep their values. Before that, private foods such as "Coffee with milk" still have 0 fluid until changed in the Supabase table editor (or a food edit screen is added). `supabase/backfill_fluids_alcohol.sql` (one-off, run) sets fluid/alcohol on your own foods and copies fluid, alcohol and creatine onto past log entries.
4. **(Built, see 2a-bis) Goals setting.** A simple form for calorie and protein targets (one row in `goals`, upsert on `user_id`), probably reachable from the header menu. Then use the goals as the denominators for the totals bars.
5. (Done, fluids only) Daily summary totals. Alcohol is left for the Trends page.

Checks after each step: load the app, log an entry, and confirm the row in the Supabase table editor has the expected columns. Remember the supabase-js rule about calling other methods inside `onAuthStateChange`.

### 2a-bis. Daily summary and goals design (agreed and built 2026-11-10)
Built: header profile menu (photo or initial; email, Goals, Sign out), Goals sheet (on/off switch plus value per goal; off stores null), summary bars as designed below.
- **Goals:** calories 2,200 (a ceiling), protein 150 g, fluids 3,000 ml, creatine 10 g. No carb or fat goals. Changed 2026-11-11: a user with no `goals` row gets only a neutral 2,000 calorie ceiling; protein, fluids and creatine are off until switched on in the Goals sheet (starting values 100 g, 2.5 L, 5 g). Off means: fluids and creatine disappear from the summary, protein keeps its bar as a share of calories, and in Trends creatine's card disappears while fluids' chart stays without a goal line.
- **Schema:** `creatine_g` on `foods` and `log_entries`; `fluid_ml` and `creatine_g` on `goals`; `creatine_g` added to `daily_totals` (in `schema.sql`; `supabase/seed_supplements.sql` adds "Creatine (10 g)" and "Creatine (5 g)"). Both have been run.
- **Summary shows little text; bars carry progress.** Goal numbers are not shown in the summary, only in the goals form.
  - Calories: big number plus a small "N left". The bar warns amber then red past the ceiling.
  - Protein: grams, bar filling toward 150. Carbs and fat: grams only, bars as a share of the day's calories (no goals).
  - Fluids: litres ("1.25 L"), bar toward 3 L, "done" look once reached. This replaces the "Fluids" text beside the water button; the button stays.
  - Creatine: same bar style as the others, shows the logged grams ("10g"), with a check once the goal is reached.
  - Layout: two rows on the same three columns (Protein/Carbs/Fat, then Fluids/Creatine). Calorie bar is 4px like the rest.
  - Alcohol is NOT on the daily summary: it is a trend over time, so it belongs on the Trends page.
- **Later:** a pace tick on each bar (where you'd be by this time of day), using a waking-hours window.

### 2a-quater. Goals helper (built 2026-11-12)
A collapsed "Help me choose" section in the Goals sheet. Inputs: year born, sex (Male / Female / Other, where Other averages the formula), height and weight with a US / Metric switch (US default), activity (4 levels) and an aim. "Fill in my goals" fills the calorie, protein and fluid boxes and switches them on (not creatine); nothing is saved as goals until "Save goals". Fill then folds the helper away, scrolls back to the goals and shows a toast (no explanation text: the boxes show what changed). Input problems show in red under the button.
- **Remembered:** the inputs are saved to a new `profiles` table (one row per user, own-row RLS, stored metric) when you tap Fill, and prefill the helper next time. Guests keep it on the device; it merges on sign-in. Later, weight tracking (section 4) can supply the weight.
- **Calories:** Mifflin-St Jeor x activity (1.2 / 1.375 / 1.55 / 1.725), then the aim as a percentage of maintenance, rounded to 50, never below 1,500 (male), 1,200 (female), 1,350 (other).
- **Aims (decided):** Lose slowly -10% with 2.0 g/kg protein; Lose faster -20% with 2.2 g/kg; Maintain with 1.6 g/kg; Build muscle +10% with 2.0 g/kg. The lose options show the expected weekly pace from the person's own numbers. Percentages rather than a fixed -500 so the change scales with the person; "aggressive" avoided on purpose; a "recomp" option left out (it is Maintain with high protein).
- **Protein and fluids** (35 ml/kg) use the weight for a BMI of 25 when the person is heavier, since per-kg rules overshoot.
- **Wording:** an estimate, not medical advice; under 18 it does not calculate. Goal rows now carry hints ("often 1.2–2 g/kg", "most adults 2–3 L", "usually 3–5 g").

### 2a-ter. Configurable quick-add buttons (built and live)
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

### 2b. Trends page (replaces History; design agreed 2026-11-10)
Inspired by the Garmin/Apple Health style. Charts are hand-drawn inline SVG (no chart library), mobile-first, two columns of cards on desktop.
- **Controls:** a `7d | 4w` toggle and a "‹ Nov 4 – 10 ›" row that steps back by one window. A Day view (1d) comes later, once `eaten_at` has enough data.
- **One rule for every chart:** bars are coloured by whether the day met its goal. Calories: success is under the ceiling (amber if over). Protein, fluids, creatine: success is at or above the goal (slate when missed). Goal line is always drawn. Each card has stat tiles: average daily and "days under/at goal". Days with no calories logged are gaps (a water-only day is not a tracked day). Today is in progress: drawn with a grey ghost up to the goal, and left out of the averages and counts. A 7-day average line sits over calories and protein.
- **Tap a bar** to select a day: the readout shows its value with an "Open day" link into Today.
- **Step 1 (done):** Trends tab (replaces History), toggle, range arrows, calories and protein cards.
- **Step 2 (built, needs a test):** fluids (bars, goal line, average), one stacked carbs and fat chart (no goal, no colouring), creatine as a compact one-row dot strip (purple = taken, dim slate = missed, dashed ring = today still to do; weekday letters in 7d; "N of M days at goal" in the card header; days before your first logged creatine are not counted; hidden if the creatine goal is off), weekly alcohol totals (last 8 calendar weeks Mon-Sun ending at the window's week, current week dashed outline; no guideline line, maybe an optional weekly limit in Goals later).
- The old Past days list is removed (tap a bar, then Open day). Day (1d) view moved to "Maybe later" at the top.
- **Creatine card (done 2026-11-13):** the header adds a current streak ("N days in a row", shown from 2) after "N of M days at goal". The streak counts back from today, or from yesterday while today is still to do, and ignores the window, so it is always "now" (its own `daily_totals` query, up to 400 days). On the 4-week view the dots are a grid of 4 rows of 7 consecutive days (each column one weekday, rows labelled with their first date), so a habitually skipped weekday shows as a column. 7 days stays one row.
- Data: `daily_totals` has everything, no schema change. The later Day view reads `log_entries` directly.

## 2c. Grouped entries on Today (built and live)
Repeats of the same food on a day (2 or more, matched by `food_id`, or by name for one-offs) collapse into one row: name, total servings, time range and the group's totals. Tap to expand and see each entry with its own edit, log-again and delete. The group row has log-again (copies the latest entry) but no delete. The group sits at its most recent entry's position and starts collapsed; expansion resets when you change day.

## 3. Guest mode (built and live 2026-11-11, except the consent-screen step below)
**Why:** guests will be friends and prospective employers. Employers are not on the Google test-user list, so today they cannot sign in at all; guest mode is their whole experience, so it must work well with no sign-in wall and no sample-data button (decided against).

**Decisions**
- Guests get the **whole app** (log, foods, favourites, goals, quick-adds, Trends, grouping), not a cut-down version.
- **Stand-in backend:** a small fake `sb` in `index.html` that answers the same calls the app already makes (`from(...).select/insert/update/upsert/delete`, `eq`, `in`, `gt`, `gte`, `lte`, `order`, `limit`, `maybeSingle`) from `localStorage`, and computes the `daily_totals` view from entries. Guest mode swaps it in; signing in swaps in the real Supabase client. The rest of the app is unchanged. Rejected: separate guest code per feature (duplication); Supabase anonymous sign-in (opens the database to unlimited anonymous users and writes with the public key, linking fails if the Google account already has data, and the session still lives in the browser); a cut-down guest mode (weak demo); IndexedDB (more complex, not needed for this volume).
- **Ids are generated in the browser (uuid)** so rows keep their ids when uploaded.
- **Standard foods for signed-out users:** change `schema.sql` so the `anon` role can read `foods` where `owner_id is null` (check the `grant select` too). Re-runnable. Those foods are already public in the repo.
- **Telling guests to sign in:** a slim, never-blocking banner at the top of Today ("Guest mode: saved on this device only. Sign in to keep your data" plus a Sign in button), the header profile button becomes "Sign in", and a one-time toast after the first log. After a few entries or about a week the banner gets more prominent. Be honest that Safari can clear site storage after about 7 days of inactivity.
- **Merge on sign-in:** copy local foods, entries, favourites, quick-adds and goals up with their ids kept. A guest food whose name matches one the account already has attaches to the existing food. Additive and safe to repeat. Clear the local copy only after the upload succeeds. Google sign-in redirects away and back, so the local data must survive the reload (it is in `localStorage`).

**Build order**
1. **(Built, tested)** The stand-in backend (`makeLocalClient()`). Guest data is in `caltal_guest_v1`.
2. **(Built, schema run)** Anon read access to standard foods. The app fetches them with the publishable key and caches a copy in `localStorage`.
3. **(Built and live)** **No sign-in screen:** anyone without a session lands straight in guest mode. A conspicuous amber banner at the top ("Guest mode. Your data is saved on this device only. Sign in to keep it and use it anywhere." plus a "Sign in with Google" button) shows for guests only; the profile menu's last item is "Sign in with Google"; a toast after the first log in a session says "Saved on this device. Sign in to keep it." Signing out lands you in a fresh guest session. The guest's profile button is a hamburger icon (not an avatar). Decided: no stronger nudge over time.
4. **(Built and live, real sign-in test pending)** Merge on sign-in: `mergeGuestData()` runs when a real user's session starts and local guest data exists. Foods, favourites, entries, goals and quick-adds are copied up with their ids kept (so a repeat does nothing twice). A guest food whose name matches one the account already has attaches to it; references to foods that no longer exist are dropped (the entry keeps its name). Goals and quick-adds are copied only if the account has none. The local copy is deleted only after everything uploaded; on any error it stays and a toast says so. A toast reports how many entries were added. Note: leftover guest data on a shared browser would merge into whoever signs in next.
5. **(Done with your account; second account pending)** Test the merge with a real Google sign-in, then with a second Google account.
6. **Publish the Google consent screen** (Google Cloud, a step for Steve): from Testing to In production so any Google account can sign in. Basic sign-in scopes should not need Google's verification review and should not show an "unverified app" warning, but confirm by signing in with an account that is not on the test list. It is reversible and does not expose data (row-level security keeps each user's rows separate). Signed-in users' emails appear in Supabase under Authentication > Users, which gives contact details.

## 4. Weight (planned 2026-11-13)
**Apple Health background.** A website cannot read or write Apple Health; only native apps can (no web API). The bridge is the Shortcuts app, which can read Health samples and "Log Health Sample". Decided: Apple Health sync is a private feature for Steve only; if friends ever want it, that means making CalTal a native app.

**Stage 1 (built 2026-11-13): weight in CalTal, for everyone.**
- `daily_metrics`: one row per user per day (`weight_kg`, `source` manual/import/shortcut, `updated_at`), own-row RLS. Stored in kg, shown in `profiles.units` (lb by default). Guests have it in the stand-in; it merges on sign-in.
- Optional goal weight on `goals.weight_kg` (null = none), set in the Weight sheet, not the Daily goals sheet.
- **Weight sheet** from the profile menu (shows the latest weight): logs for the day being viewed, lb/kg switch (saved to the profile), goal weight row, "Remove this weigh-in", and the last 10 weigh-ins (tap one to edit that day). The box's placeholder is your latest weight. Switching units and saving an unchanged value keeps it exact.
- **Trends card** (after Calories; only once there is a weigh-in or a goal weight): its own scale (not from zero), dots for weigh-ins, a line for the average of the weigh-ins in the 7 days up to each day, dashed goal line when it fits without flattening the data (else just in the legend). Tiles: latest, change in average across the window, distance to goal. Tap a day: value, average, and "Edit ›" / "Add weight ›" into the sheet.
- The Goals helper prefills weight from the latest weigh-in.

**Stage 2: Steve's daily Shortcut (Health and CalTal in one step).** A "Log weight" Shortcut (home screen, widget or Siri) asks for the weight, writes it to Apple Health (Log Health Sample) and posts it to CalTal. Needs: a `sync_keys` table holding a hashed personal key (no policies, so the app cannot read it); a `log_weight(key, date, value, unit)` security-definer function callable with the publishable key, which finds the user by key and upserts that day's weight (source 'shortcut'); the key generated once in the SQL editor and pasted into the Shortcut (never in the repo or chat; replaceable with one line). Weights typed in CalTal do not reach Health (fine for corrections).

**Stage 3: history.** One-off import of Apple Health's export (zip with a large XML) by a Python script like `scripts/migrate_from_sheet.py`; earliest weigh-in of each day; source 'import'.

**Only if Steve gets a smart scale:** a morning Shortcuts automation reads new Health weights and calls the same `log_weight`. Both directions together are harmless: one weight per day, and a manual entry wins.
