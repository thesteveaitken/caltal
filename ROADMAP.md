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

## 1. Logo and desktop layout
- Show the logo in the header and on the sign-in screen. `caltal-icon.png` is not in the repo yet and needs committing (or inlining like the favicon).
- Desktop (about 900px and up): widen the page to roughly 1100px and move the Today/History tabs into the header.
  - Left column: totals and "Logged Today".
  - Right column: food search and Add.
  - History or trends: a full-width page.
- Sign out already exists (bottom of History). Move it into the header menu on desktop.

## 2. Macro charts over time
- Source: the `daily_totals` view. Days with no entries have no rows, so they are skipped. Draw gaps, not zeros.
- Library: a pinned Chart.js from a CDN, to keep the no-build rule.
- Open question: a day logged only partway through can still skew a trend.

## 3. Guest mode
- A signed-out user can log foods. Entries live in `localStorage`, not memory, because Google sign-in redirects away and back and reloads the page.
- After sign-in, insert the local entries into the database and clear the local copy.
- Show a banner or similar: sign in to save your macro history. Losing guest data in a new session is acceptable.
- Needs a local version of the data layer beside the Supabase one.
- Needs RLS to allow reading standard foods without signing in.
- Adding a custom food could require an account, as a natural sign-in prompt.
- Catch: the Google consent screen in Testing mode blocks anyone not on the test-user list from creating an account. Publishing the consent screen removes that limit.

## 4. Water and alcohol tracking
Changes the database, so design it first.
- Water: a separate daily amount (for example `water_ml` per user per day), not a food.
- Alcohol: a standard-drinks field on `foods` and `log_entries`. The seeded beers, wine and spirits would need values.
