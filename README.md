# MM Tournament HQ

Single-file app for running the MGA Member-Member tournament: sponsors, outreach,
budget, financial summary, food & beverage, schedule, and open decisions. One shared
board password, live sync across devices.

**Stack:** one static `index.html` (no build step) · Supabase (auth + one JSONB row + realtime) · Render static site.

## Setup (once)

### 1. Supabase
1. Create a project at supabase.com.
2. SQL Editor → run `supabase-setup.sql` (creates the `mm_tournament` table, RLS, realtime).
3. Authentication → Users → **Add user**
   - Email: `board@mgamm.app` (doesn't need to be real — check **Auto Confirm**)
   - Password: this becomes the board password.
4. Authentication → Sign In / Providers → Email → turn **off** "Allow new users to sign up."

### 2. Configure the app (Render environment variables)
The app reads `window.MM_CONFIG` from a `config.js` file that **Render generates
at build time from environment variables** — nothing credential-related lives in
the repo (config.js is gitignored).

1. Render → your static site → **Environment** → add:
   - `SUPABASE_URL` — e.g. `https://abcd1234.supabase.co`
   - `SUPABASE_ANON_KEY` — Settings → API → anon public key
   - `BOARD_EMAIL` — the shared Auth user's email (must match Supabase exactly)
2. Render → **Settings → Build Command**, paste:

   ```
   printf "window.MM_CONFIG={url:'%s',anonKey:'%s',boardEmail:'%s'};" "$SUPABASE_URL" "$SUPABASE_ANON_KEY" "$BOARD_EMAIL" > config.js
   ```

3. **Manual Deploy → Clear build cache & deploy.**
4. Verify: `https://<your-site>/config.js` should show your real values, and the
   site should now open with the board password screen.

Changing any value later = edit the env var in Render and redeploy. No commits.

For **local testing** without Render: copy `config.example.js` to `config.js`
in the folder and fill it in, or skip it entirely — no config.js means the app
runs local-only per device (no password screen, no sync dot next to the year
pill). If the deployed site ever shows that, the build command or env vars are
missing.

### 3. Render
1. Push this repo to GitHub (private is fine).
2. Render → **New → Static Site** → connect the repo.
3. Branch `main`, build command *empty*, publish directory `.` → Create.
4. Optional: Settings → Custom Domains to hang a subdomain on it (one CNAME).

### 4. First sign-in
The first device to sign in seeds the cloud from its local data. After that,
cloud is the source of truth on every load.

## Operations

- **Board password change / turnover:** Supabase → Authentication → Users → reset
  the shared user's password. Nothing to redeploy.
- **Backups:** app menu (⋯) → *Backup all data* downloads a JSON of every year.
  Creating a new year auto-downloads one first. *Restore backup* loads it back
  (and syncs up to the cloud).
- **Sync status:** dot in the header — green saved, gold saving, red offline
  (offline changes are kept on-device and pushed on the next edit).
- **Conflict model:** last-write-wins on the whole state, debounced 800ms.
  Fine for a small board; if two people edit the same field in the same second,
  one edit wins.

## New tournament year

Year selector (top) → **New year**. Carries over sponsors and prospects with
contact info (statuses reset, deposits cleared), budget structure, misc expense
lines, F&B menu, tiers, and the schedule — with all actuals zeroed. Declined
prospects stay declined.

## Keeping free tiers awake

- **Render static sites never sleep** — they're CDN-served. Nothing to do.
- **Supabase free tier pauses after 7 days of no API activity** (off-season risk).
  This repo includes `.github/workflows/supabase-keepalive.yml`, which pings the
  `keepalive` table every 3 days. To activate it:
  1. Repo → Settings → Secrets and variables → Actions → add two secrets:
     `SUPABASE_URL` and `SUPABASE_ANON_KEY` (same values as in index.html).
  2. Actions tab → enable workflows → run **Supabase keep-alive** once manually
     to confirm it goes green.
  The workflow also commits a timestamp to a `keepalive` side branch each run so
  GitHub's 60-day inactive-schedule rule never disables it, without triggering
  Render deploys (Render only watches `main`).
- **If it ever pauses anyway:** Supabase dashboard → Restore. Data isn't lost on
  pause, but don't leave it paused for months — and keep occasional JSON backups
  from the app menu regardless.
