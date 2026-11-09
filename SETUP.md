# CalTal setup: Supabase + Google sign-in

CalTal is a single static `index.html` hosted on GitHub Pages. It talks directly to Supabase:

- **Postgres** stores the foods, favourites and log entries.
- **Supabase Auth** handles Google sign-in.
- **Row-level security** makes sure each user sees only the standard foods plus their own foods and logs.

```
index.html                    the whole app
supabase/schema.sql           tables + security policies (run once)
supabase/seed_foods.sql       standard food list (review, then run)
scripts/migrate_from_sheet.py one-off import of the old Google Sheet
AppsScript.gs                 old backend; delete once migrated
```

## 1. Create the Supabase project
1. Go to [supabase.com](https://supabase.com) → New project. Pick a region near you and save the database password somewhere.
2. Open **SQL Editor → New query**, paste in `supabase/schema.sql` and click **Run**.
3. Review `supabase/seed_foods.sql`: edit values and add any foods you want promoted from your old sheet. Then paste it in and **Run** it. You can re-run it safely, because existing names are skipped.
4. Put two values into `index.html`:
   ```js
   const SUPABASE_URL = 'https://xxxx.supabase.co';
   const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...';
   ```
   - **Publishable key** (`sb_publishable_...`): **Project Settings → API Keys**. Supabase is retiring the older `anon` and `service_role` keys in early 2027, so use the new key types.
   - **URL:** the new API Keys page doesn't show it. It is always `https://<project-ref>.supabase.co`, where the project ref is the **Project ID** under **Project Settings → General**. It's also the last part of your dashboard address (`supabase.com/dashboard/project/<project-ref>`). The **Connect** button at the top of the dashboard shows the full URL too.

   The publishable key is safe to commit, because RLS protects the data. **Never** put the secret key (`sb_secret_...`) in `index.html`.

## 2. Google sign-in
1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project, then go to **APIs & Services**.
2. **OAuth consent screen**:
   - User type: External. Fill in the app name and support email.
   - Scopes: the defaults (`email`, `profile`, `openid`) are enough.
   - Publishing status: leave it on **Testing**, and add your own Gmail plus each friend's under **Test users**. This acts as your invite list (up to 100 people). Anyone not on the list can't sign in.
3. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized JavaScript origins: `https://<your-username>.github.io` and `http://localhost:8000`.
   - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`. Supabase shows this exact URL on its Google provider page.
4. In Supabase, go to **Authentication → Sign In / Providers → Google**. Enable it and paste in the Client ID and Client Secret.
5. In Supabase, go to **Authentication → URL Configuration**:
   - Site URL: your GitHub Pages URL, e.g. `https://<you>.github.io/caltal/`.
   - Redirect URLs: add the same Pages URL and `http://localhost:8000/**`.

## 3. Make yourself admin (lets you edit standard foods)
Sign in to the app once. Then, in the SQL Editor:
```sql
insert into public.admins (user_id)
select id from auth.users where email = 'you@gmail.com';
```
Admins maintain the standard list in **Table Editor → foods** (rows where `owner_id` is empty) or with SQL. Foods added in the app are always private to whoever adds them.

## 4. Import your old Sheet data
1. In the Google Sheet, go to **File → Download → CSV**, once on the `Foods` tab and once on the `Log` tab. Save the files as `Foods.csv` and `Log.csv` in the project folder. They're gitignored.
2. Create `scripts/.env` by copying `scripts/.env.example`, and fill in all three lines:
   ```
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   CALTAL_USER_ID=<your user UID>
   ```
   - `SUPABASE_URL`: the same URL you put in `index.html`.
   - `SUPABASE_SECRET_KEY`: **Project Settings → API Keys**, the secret key (`sb_secret_...`). It bypasses the security rules so the script can write on your behalf. Keep it only in this file. `.env` is gitignored, so don't paste the key into `index.html` or any other file.
   - `CALTAL_USER_ID`: **Authentication → Users**, the **User UID** on your row (a UUID like `3f2b8c1e-9a4d-...`). You must have signed in to the app once for it to exist. Everything imported is attached to this user.
   No quotes are needed around any of the values.
3. Only if you promoted foods: `promote.txt` lists foods that should become **standard** foods (visible to everyone) instead of private ones. Skip this step otherwise, and add `--promote promote.txt` only if you use it.
   - Put one food name per line. The names must match the **Name** column in your exported `Foods.csv` exactly, ignoring upper/lower case.
   - Rename those rows in the sheet to the seed name first, for example `1 large egg, poached`. The seed already contains them, so the importer won't create a copy, and your old log entries get linked to the standard version.
   - Foods not listed are imported as private foods, as are standard foods you didn't promote. A private "Apple" next to the standard "1 medium apple" is harmless, just a bit redundant.
4. Run the dry run first, then the real import:
   ```sh
   python3 scripts/migrate_from_sheet.py --foods Foods.csv --log Log.csv --promote promote.txt --dry-run
   python3 scripts/migrate_from_sheet.py --foods Foods.csv --log Log.csv --promote promote.txt
   ```
   Add `--day-first` if your sheet's dates look like `21/06/2026`.
5. Check a few days in the app against the sheet. Then, in Apps Script, go to **Deploy → Manage deployments → Archive** to shut the old endpoint off, and delete `AppsScript.gs`.

## 5. Run locally / deploy
- Local: `python3 -m http.server 8000`, then open http://localhost:8000.
- Deploy: commit and push to the GitHub Pages repo as before.

## Notes
- **Free tier pausing:** Supabase pauses free projects after about 7 days with no activity. If the app stops loading after a quiet week, open the Supabase dashboard and click **Restore**.
- **Adding email magic links later:** enable Email in Supabase Auth and add an email field that calls `sb.auth.signInWithOtp({ email })`. No database changes are needed.
