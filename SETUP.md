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
   - `supabase/migrations/0004_categories.sql` — role categories column + category-aware pins function. Run the worker once afterwards to populate it.
   - `supabase/migrations/0005_categories_function.sql` — SQL-aggregated category counts for the filter list.
   - `supabase/migrations/0006_pins_logo.sql` — pins carry the company logo. Run `npm run logos` afterwards.
   - `supabase/migrations/0007_cities.sql` — auto-discovered cities, multi-location companies, pin precision.
   - `supabase/migrations/0008_lean_jobs.sql` — drops stored descriptions (fetched from the ATS at page render instead) and adds the excluded flag for out-of-scope places.

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
| `LOGO_DEV_TOKEN` (optional) | free token from logo.dev for higher-quality company logos in `npm run logos` |

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

The starter CSV (~70 companies) was harvested from real job postings, so most tokens validate; boards do get renamed, so **expect a few INVALID rows**. For each, either find the current token (open the company's careers page and look at the URL: `boards.greenhouse.io/<token>`, `jobs.lever.co/<token>`, `jobs.ashbyhq.com/<token>`) and fix the row, or delete it. Re-run — valid rows are untouched (idempotent). Rows without an address only create the company; the worker discovers their offices.

A geocode FAILED means Nominatim couldn't resolve the address string; simplify it (e.g. `"Culver City, CA"`) and re-run.

Verify: Table Editor → `locations` rows have `city_slug = los-angeles` and non-null `geom`.

### Adding companies at scale (YC, portfolios, any list)

```
npm run discover -- --yc --hiring            # YC companies flagged hiring, matched to known boards (fast, no guessing)
npm run discover -- --yc --probe --limit 300 # …also test likely tokens against the ATS APIs (slower: ~1 request/300ms)
npm run discover -- --harvest --limit 200    # top boards from data/boards.json (real tokens; websites unknown → monogram pins)
npm run discover -- --list a16z.csv --probe  # any list you paste: columns name,website (e.g. a portfolio page copied to CSV)
npm run discover -- --url https://www.techstars.com/portfolio --probe --dry   # scrape company links off a portfolio page
```

Add `--dry` to preview. Rows are appended to `companies.csv` (existing tokens skipped) with the source's HQ city as an approximate address and, for YC, the directory logo. Then `npm run seed` → `npm run logos` → `npm run worker` as usual.

Where tokens come from: `data/boards.json` holds ~1,800 boards harvested from real application URLs — matching against it never guesses. `--probe` fills gaps by testing slug/domain-derived tokens; Greenhouse boards are name-verified via the API, Lever/Ashby only accepted on an exact slug/domain match. Only YC has an open dataset. Other accelerators and investors (Techstars, 500 Global, Antler, a16z, Sequoia…) publish portfolio *pages*: try `--url <page> --dry` first — it extracts one company per outbound link and works when the page is plain server-rendered HTML. If it finds nothing (JavaScript-rendered page), copy the portfolio into a two-column `name,website` CSV and use `--list`. Either way, jobs come from each company's own board — the accelerator is only how you pick companies.

Scale note: the worker geocodes at most `GEOCODE_BUDGET` (default 800) new places per run and defers the rest to the next run, so onboarding hundreds of companies spreads over a few scheduled runs instead of one multi-hour run. The summary line `geocoding: N lookups, M deferred` shows progress.

### Scope: which countries

`data/targets.json → allowedCountries` (ISO codes) decides which jobs are stored. Default is Tier 1: US, IN, GB, IE, CA, DE, NL, FR, SE, DK, CH, ES, PT, IL, SG, AU, NZ, AE. Adding a country is one code; jobs there appear on the next worker run, and previously excluded strings are re-evaluated automatically. Removing one lets the normal "not seen this run" rule retire its jobs.

### Logos

```
npm run logos
```

Fetches each company's logo once (from its website domain) into `public/logos/<slug>.png` and sets `companies.logo_url`. Keyless by default via Google's favicon service; for higher-quality logos, sign up free at logo.dev, add `LOGO_DEV_TOKEN=...` to `.env.local`, and run `npm run logos -- --force`. **Commit the `public/logos/` files** — Vercel serves them; nothing fetches logos at runtime. Companies without a logo get a monogram pin.

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

Boards are fetched 5 at a time (`WORKER_CONCURRENCY`). Locations resolve offline through `data/cities-tier1.json` — ~160 Tier-1 metros with aliases — so "San Francisco, CA", "Bengaluru", "NYC", "Gurgaon" never touch a geocoder. Only unknown strings (small towns) go to OpenStreetMap, once each, within `GEOCODE_BUDGET` (default 800) per run. Jobs in countries outside `data/targets.json → allowedCountries` are skipped, not stored. Real-office lookups are off by default (`POI_LOOKUP=1` to enable); new offices are city-center placeholders.

**Big onboarding batch (hundreds of companies):** `GEOCODE_BUDGET=3000 npm run worker` — or trigger the GitHub workflow with the `geocode_budget` input. Expect ~30–45 minutes for ~2,000 companies, most of it fetching boards.

Expected: one line per company, then a RUN SUMMARY with fetched/new/updated counts, deactivations, and fixtures removed. Run it a **second time** — everything should show `new 0` and `updated N`. That confirms idempotency.

### How job locations become pins

The worker reads each job's location string ("Pune, Maharashtra, India", "Redmond, WA") and resolves it to a city (geocoded once, cached in `location_aliases`) and to an office row for that company in that city. A company with jobs in four cities gets four pins, and new cities appear in the dropdown automatically. Pin precision, from best to worst:

| precision | how it was placed | how to get it |
|---|---|---|
| `address` | geocoded street address | a row in `companies.csv` for that company + city, then `npm run seed` |
| `poi` | the company's office found in OpenStreetMap | automatic when OSM has it |
| `city` | near the city center, drawn with a dashed ring, marked "≈ city" | automatic fallback |

Job feeds never include street addresses, so `city` is the honest default for offices you haven't curated. To make any pin exact, add its address to `companies.csv` and re-run the seed — the worker reuses that row from then on. Remote roles pin to HQ with a Remote badge. Metro grouping (Santa Monica → Los Angeles, Palo Alto → San Francisco…) lives in `lib/metro.ts`.

Watch the `+cities` / `+offices` columns in the run summary to see what a run discovered.

Watch the `other` column too: it counts jobs the classifier couldn't place in a role category (`lib/categorize.ts`). Skim those titles and add keywords — the next run re-categorizes everything.

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

Phone test: `npm run dev -- -H 0.0.0.0`, then open `http://<your-computer-ip>:3000` on a phone on the same wifi. (`next.config.ts` already allowlists private LAN ranges via `allowedDevOrigins` — without that, Next 16 blocks its own scripts for non-localhost origins and the page sits on "Loading…" forever.)

---

## 7. Worker on autopilot (GitHub Actions)

### One-click onboarding (recommended for big batches)

After the migrations are run and the two secrets are set: **Actions → onboard-companies → Run workflow.** It runs discover (YC and/or the harvested boards, per the inputs) → seed → logos → commits `companies.csv` and `public/logos/` back to the repo → runs the worker with the geocode budget you choose (default 3000). ~45–60 minutes for the full ~2,000-company batch, unattended. Re-run it any time you want more companies; it only adds what's new.

### Scheduled maintenance

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
| Browser error `Missing env var NEXT_PUBLIC_SUPABASE_URL` while API routes work | The dev server was started before `.env.local` existed or was edited — Next inlines `NEXT_PUBLIC_*` vars into the browser bundle at startup. Restart `npm run dev`. |
| `/api/pins` returns `{"error":"... pins_for_city ..."}` | Migration 0002 not run. |
| `/api/pins` returns `"count": 0` for Los Angeles | Either seed hasn't run, or `locations.city_slug` isn't `los-angeles` — check the METRO map in `scripts/seed.ts` covers your cities. |
| Pins render but panel says "Couldn't load jobs" | Wrong anon key in `.env.local`, or RLS policies missing (re-run 0001's policy block). |
| Job page 404s for a job that exists | Migration 0003 not run (inactive jobs) or the slug in the URL is wrong. |
| Page stuck on "Loading companies…" / "Loading map…" with no chips, when opened via LAN IP or phone | Next 16 blocked its dev scripts for that origin. Add your network range to `allowedDevOrigins` in `next.config.ts` (private ranges are pre-listed) and restart `npm run dev`. |
| Map area is blank/grey | OpenFreeMap tiles blocked by your network/adblocker, or no internet. Check the browser console. |
| Map shows but with softer/raster tiles and a CARTO attribution | Your browser has no WebGL, so the app switched to the Leaflet fallback automatically. Fully functional; normal devices get the crisp MapLibre map. |
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
