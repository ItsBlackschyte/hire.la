# hire.la — setup from zero

The complete runbook: from an empty machine to a running app with live jobs, then to production. Follow it top to bottom once; afterwards the day-to-day is just `npm run dev` and the worker running itself.

Expect ~45 minutes end to end, most of it waiting on geocoding and reading output.

---

## 0. Prerequisites

| Need | Check |
|---|---|
| Node.js 22 (LTS) | `node -v` → v22.x. If you use nvm: `nvm use` (reads `.nvmrc`) |
| Git | `git -v` |
| A Supabase account (free) | supabase.com |
| Later: GitHub + Vercel accounts (free) | for autopilot + hosting |

---

## 1. Install

```
cd hire-la
npm install
npm run typecheck        # should print nothing (no errors)
```

---

## 2. Database (Supabase)

1. supabase.com → New project → name `hire-la`, pick a region near your users (US West for LA), set a strong DB password (you won't need it day-to-day).
2. Wait for the project to finish provisioning (~2 min).
3. **SQL Editor → New query.** Run these three files **in order**, one at a time, each pasted whole and executed once:
   - `supabase/migrations/0001_init.sql` — tables, indexes, RLS. Enables PostGIS itself.
   - `supabase/migrations/0002_pins_function.sql` — the `pins_for_city()` function the map API calls.
   - `supabase/migrations/0003_public_read_all_jobs.sql` — lets closed job pages render.

   Each should end with "Success. No rows returned."
4. **Table Editor** → confirm `companies`, `locations`, `jobs` exist (each shows an RLS shield icon).

If a migration errors with "already exists", it was already run — skip it.

---

## 3. Environment variables

```
cp .env.example .env.local
```

Fill it from **Supabase → Project Settings → API**:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (`https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **anon / public** key (or the newer `sb_publishable_…` key — both work) |
| `SUPABASE_URL` | same Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the **service_role** key (or newer `sb_secret_…`). Treat like a password — it bypasses all security rules |

`.env.local` is gitignored. Never commit it, never put the service key anywhere browser-facing.

---

## 4. Seed companies

```
npm run seed
```

For each row in `companies.csv` this validates the ATS token against the live board, geocodes the address (1 request/sec — first run takes ~20s), and inserts the company + office. Ends with a summary table:

```
SpaceX               token: valid        jobs: 812   geo: 33.9207, -118.3278   db: inserted
Whatnot              token: INVALID (HTTP 404) ...                             db: skipped
```

**Expect some INVALID tokens** — the starter CSV rows are candidates, not confirmed. For each invalid one, either find the right token (open the company's careers page and look at the URL: `boards.greenhouse.io/<token>`, `jobs.lever.co/<token>`, `jobs.ashbyhq.com/<token>`) and fix the row, or delete the row. Then re-run — valid rows are untouched (idempotent), only fixed ones get processed.

A geocode FAILED means Nominatim couldn't resolve the address string; simplify it (e.g. `"Culver City, CA"`) and re-run.

Verify: Table Editor → `locations` rows have `city_slug = los-angeles` and non-null `geom`.

### Fixtures (optional — skip if you're going straight to the worker)

`npm run fixtures` inserts ~15 fake jobs so the UI has something to show before real ingestion. The worker deletes them automatically on its first successful run. Useful only if you want to see the frontend before step 5.

---

## 5. Ingest real jobs

Optional smoke test first — fetches live boards, writes nothing:

```
npm run ats                      # every Greenhouse company in the CSV
npm run ats -- spacex --json     # one board, full normalized output
```

Then the real run:

```
npm run worker
```

Expected: one line per company, then a RUN SUMMARY with fetched/new/updated counts, deactivations, and fixtures removed. Run it a **second time** — everything should show `new 0` and `updated N`. That confirms idempotency.

Watch the `hq-fallback` column: it counts jobs whose location string didn't match a specific office and fell back to HQ. A few is normal (remote roles land here by design). A company where *most* jobs fall back means its location strings need matcher attention — run `npm run ats -- <token>` to see them.

---

## 6. Run the app

```
npm run dev
```

Open http://localhost:3000 and walk this checklist:

- LA map renders with orange pins showing job counts; zoom out → they cluster
- Country/city dropdowns fly the map; India → Pune shows the "no companies yet" card
- Department chips appear; picking one changes pin counts and the URL (`?dept=`)
- Tap a pin → company panel with jobs → job title opens `/jobs/<slug>` with full description → Apply goes to the company's site
- http://localhost:3000/api/pins?city=los-angeles → JSON with your companies
- http://localhost:3000/sitemap.xml → lists every job and company URL
- http://localhost:3000/about and /privacy render

Phone test: `npm run dev -- -H 0.0.0.0`, then open `http://<your-computer-ip>:3000` on a phone on the same wifi.

---

## 7. Worker on autopilot (GitHub Actions)

1. Push the repo to GitHub (public repo = unlimited Actions minutes).
2. Repo → Settings → Secrets and variables → Actions → New repository secret, twice: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Actions tab → **fetch-jobs** → Run workflow. Open the run → the log ends with the same RUN SUMMARY you saw locally.

From here it runs at 03:00 and 15:00 UTC daily. GitHub pauses schedules after 60 days without repo activity — any commit resets that.

---

## 8. Deploy (Vercel)

1. vercel.com → Add New Project → import the GitHub repo. Next.js is auto-detected; no build settings to change.
2. Environment Variables → add **only** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The service key stays out of Vercel.
3. Deploy → repeat the section 6 checklist on the `*.vercel.app` URL.

Domain, Search Console, and AdSense steps are in `LAUNCH.md`.

---

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY` | `.env.local` missing or not filled. Scripts read `.env.local` then `.env`. |
| `/api/pins` returns `{"error":"... pins_for_city ..."}` | Migration 0002 not run. |
| `/api/pins` returns `"count": 0` for Los Angeles | Either seed hasn't run, or `locations.city_slug` isn't `los-angeles` — check the METRO map in `scripts/seed.ts` covers your cities. |
| Pins render but panel says "Couldn't load jobs" | Wrong anon key in `.env.local`, or RLS policies missing (re-run 0001's policy block). |
| Job page 404s for a job that exists | Migration 0003 not run (inactive jobs) or the slug in the URL is wrong. |
| Map area is blank/grey | OpenFreeMap tiles blocked by your network/adblocker, or no internet. Check the browser console. |
| Map blank + console: `Failed to load module script … MIME type "text/html"` | maplibre-gl v6 (ESM module worker) doesn't resolve its worker URL under Next/Turbopack. The project pins `maplibre-gl@^5` for this reason — if a `package.json` edit or `npm update` bumped it to 6.x, run `npm install maplibre-gl@^5`. (Alternative if you ever need v6: copy `dist/maplibre-gl-worker.mjs` + `dist/maplibre-gl-shared.mjs` into `public/` and call `maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs')` before creating the map.) |
| Worker: `companies ok: 0/N` and exit code 1 | Every board fetch failed — network blocked, or all tokens invalid. Run `npm run ats` to see per-board errors. |
| Worker succeeded but a company shows FAILED | That board is down or its token changed; its existing jobs are intentionally left untouched. Fix the token in the CSV, `npm run seed`, re-run. |
| `npm run seed` says "already seeded" for everything | Correct — it's idempotent. Only new/changed rows get processed. |
| GitHub Actions run is red | Open the log; the summary tells you which company failed. All-failed = check the two secrets are set correctly. |

---

## Day-to-day

Add a company → one row in `companies.csv` → `npm run seed` → next worker run picks up its jobs.
Add a city → seed its companies + one entry in `lib/cities.ts` (+ METRO mapping in `scripts/seed.ts` for multi-municipality metros).
Check health → the latest Actions run summary.
