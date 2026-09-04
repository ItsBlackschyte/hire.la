# hire.la — Handover Document

*Written 2026-09-04. Purpose: everything a new collaborator (human or AI) needs to continue this project without the original conversation.*

---

## 1. What hire.la is

A map-first job board. Companies appear as logo pins on a map; tapping a pin shows that company's live openings for the selected city and role category; "Apply" goes to the company's own application page. Jobs are pulled from public ATS boards (Greenhouse, Lever, Ashby) by a worker that runs itself on GitHub Actions. Launch city: Los Angeles; scope now: 18 "Tier-1" countries (US, IN, GB, IE, CA, DE, NL, FR, SE, DK, CH, ES, PT, IL, SG, AU, NZ, AE). Everything runs on free tiers; the only cost is the domain (`hire.la`, ~$30–40/yr). Monetization plan: SEO-friendly per-job pages → AdSense + Offerwall once traffic exists.

**Owner's stated priorities:** "make it working first, enhancements later"; tight on time; wants a full map across Tier-1 quickly; India is a personal focus but not the limit.

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Web app | Next.js 16 (App Router, TypeScript), Turbopack | on Vercel free tier |
| Map | MapLibre GL **v5** (pinned; v6 breaks under Next — module worker) + OpenFreeMap tiles (keyless) | Leaflet fallback for browsers without WebGL |
| Database | Supabase Postgres + PostGIS, RLS on | anon key = read-only; service-role key only in scripts/worker/Actions secrets |
| Worker | TypeScript, `npx tsx worker/fetch-jobs.ts` on GitHub Actions | cron 03:00/15:00 UTC + manual |
| Geocoding | Offline dictionary (`data/cities-tier1.json`) first; Nominatim (OSM) only for unknown strings, budgeted | cached forever in `location_aliases` |
| Fonts/UI | Inter (self-hosted via @fontsource-variable), monochrome Z.ai-style sidebar UI | no orange, no dashed rings, no count badges (owner decisions) |
| Logos | Fetched once to `public/logos/*.png` (Google favicon service; Logo.dev optional; YC directory thumbnails for YC companies) | served by Vercel CDN |

## 3. Repository layout (key paths)

```
app/                      Next.js routes: / (map), /jobs/[slug], /company/[slug], /about, /privacy,
                          /api/pins, /api/categories, /api/cities, sitemap.ts, robots.ts
components/               Sidebar (collapsible, selectors, settings, sign-in placeholder), MapShell, JobMap (MapLibre),
                          JobMapLeaflet (fallback), CompanyPanel (paged), JobRow, RoleSelect, CitySelector, AdSlot, icons
lib/                      types, supabase clients, cities (fallback list), useCities hook, categorize (13 role categories),
                          geo-dictionary (offline city matcher), markers (pin/cluster HTML), ats-description (on-demand fetch),
                          sanitize, settings (map style), urls, slug, csv, format, pmap, html
worker/                   fetch-jobs.ts (entry), resolve-location.ts, geocode.ts, ats/{greenhouse,lever,ashby,shared,types}.ts, test-adapter.ts
scripts/                  seed.ts, discover.ts, logos.ts, fixtures.ts
data/                     cities-tier1.json (163 metros, 600 aliases), targets.json (allowed countries + TODO tiers), boards.json (1,809 harvested boards)
supabase/migrations/      0001–0008 (run in order, once, in Supabase SQL editor)
.github/workflows/        fetch-jobs.yml (scheduled worker), onboard.yml (one-click discover→seed→logos→commit→worker)
companies.csv             the company list (currently 71; grows via discover)
public/logos/             fetched logos (committed)
SETUP.md / LAUNCH.md / ARCHITECTURE.md / STEPS.md / README.md   docs (SETUP is the runbook)
```

## 4. Data model (after migration 0008)

- **companies** — slug, name, website, logo_url, ats_type ('greenhouse'|'lever'|'ashby'), ats_token
- **locations** — company_id, label, address, city, city_slug, geom (PostGIS point), is_hq, `"precision"` ('address' exact | 'poi' OSM office | 'city' center placeholder). *`precision` is a reserved word — always quote it in SQL.*
- **jobs** — company_id, location_id, slug (stable, generated once), source_job_id, title, department (raw), **category** (normalized), employment_type, workplace_type, apply_url, posted_at, first/last_seen_at, is_active. **No description stored** (fetched from ATS at render).
  Unique (company_id, source_job_id) → idempotent upserts.
- **cities** — slug, name, region, country, country_code, lng, lat, zoom, source ('seed' always listed | 'auto' listed when it has jobs)
- **location_aliases** — raw string → city_slug, excluded (outside allowed countries), tried_at; the geocode cache
- Functions: `pins_for_city(p_city_slug, p_category)`, `categories_for_city(p_city_slug)`, `cities_with_counts()`
- RLS: public read on companies/locations/jobs/cities; aliases service-only

## 5. Key design decisions (and why)

1. **City-scoped loading, not viewport.** `/api/pins?city=slug&cat=…` — one cacheable request per city; pan/zoom never hits the DB; clustering is client-side (supercluster).
2. **URL is the single source of truth** for `?city=` and `?cat=`; selectors write it, map reads it; shareable links.
3. **Companies are slow data, jobs are fast data.** Seed once; worker owns jobs; "not seen this run" → `is_active=false`, scoped to companies whose fetch succeeded (a down board never mass-deactivates).
4. **Locations & cities are discovered from job data.** Company with jobs in Pune/Mumbai/Bengaluru gets pins in all three. Placement ladder: CSV street address → OSM office (`POI_LOOKUP=1`, off by default) → jittered city center (approximate, shown with a small "≈ city" tag in the panel; **not** a dashed ring — owner removed that).
5. **Offline geography.** `data/cities-tier1.json` resolves ~95% of location strings with no network; Nominatim only for the rest, ≤ `GEOCODE_BUDGET` per run (default 800; onboarding uses 3000), deferring extras to the next run.
6. **Country allow-list** (`data/targets.json`): jobs elsewhere are skipped, not stored; the string is remembered as excluded. Tier 2/3 codes are listed under `todo` in the same file.
7. **Role categories** (`lib/categorize.ts`): title-first keyword rules → 13 categories; department only as fallback; "Other" counts reported so rules can be tuned. English-only for now.
8. **Descriptions on demand** (`lib/ats-description.ts`): job page fetches from the ATS at render (ISR 6h). Keeps jobs ~1 KB/row.
9. **Logos in `public/`, not Supabase Storage** — Vercel's 100 GB/month CDN bandwidth vs Supabase's ~5 GB egress; same-origin; versioned.
10. **Worker concurrency 5**; seed/logos also 5-wide.

## 6. Current status (as of handover)

- All 15 original build steps done; app runs locally with real data (last local run: 61/63 companies OK, 9,737 jobs, before the lean-jobs change).
- Migrations 0001–0007 confirmed run by the owner; **0008 must be run before the next worker run** (drops `description_html`, adds `excluded`).
- Owner was about to trigger **Actions → onboard-companies** with defaults (yc+harvest, all boards, budget 3000). Expected result: ~1,900 companies, 100k+ jobs, 60–100 cities across Tier-1. The workflow commits `companies.csv` + `public/logos/` back to `main` → `git pull` before local edits.
- Deployment to Vercel and domain purchase: **not yet done** (see LAUNCH.md). AdSense: not applied (needs live domain + content).

## 7. How to run (short form; SETUP.md has the long form)

```
npm install
# Supabase: run migrations 0001…0008 in order
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional LOGO_DEV_TOKEN
npm run discover -- --yc                 # or --yc --hiring / --harvest --all / --list file.csv / --url page (add --dry to preview)
npm run seed                             # validates every token (5 parallel), inserts companies (+ HQ if address given)
npm run logos                            # public/logos/*.png, sets companies.logo_url
$env:GEOCODE_BUDGET="3000"; npm run worker   # or default 800; POI_LOOKUP=1 for real offices; WORKER_CONCURRENCY=5
npm run dev                              # http://localhost:3000  (phone: http://<lan-ip>:3000 — allowedDevOrigins set)
```
GitHub: secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (+ `LOGO_DEV_TOKEN`); workflows `onboard-companies` (one click, inputs) and `fetch-jobs` (scheduled; both share a concurrency lock).

## 8. Gotchas learned the hard way

- **Windows / OneDrive**: project lives in `Desktop\hire.la\hire-la` under OneDrive; a stray `package-lock.json` once ended up in the parent folder. Always `npm install` in the folder containing `package.json`. Consider moving to `C:\dev\`.
- **Owner's laptop has Chrome hardware acceleration off** (software WebGL). MapLibre still renders; Leaflet fallback exists if WebGL disappears entirely.
- **Blank map root cause was CSS**: MapLibre's `.maplibregl-map{position:relative}` overrode our container → 0px height. Fixed with a two-class selector `.map-main .map-container`. Check the Elements tab for the container's size before theorizing.
- **`NEXT_PUBLIC_*` must be referenced by literal name** (`process.env.NEXT_PUBLIC_X`), never `process.env[name]`, or the browser gets undefined.
- **Next 16 blocks dev scripts for non-localhost origins** unless `allowedDevOrigins` is set (private LAN ranges are set).
- **PostgREST caps queries at 1,000 rows** — aggregate in SQL functions (done for categories/pins); panel pages 50 at a time with exact count.
- **maplibre-gl v6** uses an ESM module worker via `import.meta.url` → fails under Turbopack. Stay on `^5`.
- **`precision`** is a PostgreSQL reserved word — quote it.
- Migrations are idempotent (`if not exists`/`on conflict`) so a failed run is just a re-run; there's no local Postgres to test them against before shipping.
- Supabase free project pauses after a week idle — the cron keeps it alive. GitHub disables schedules after 60 days without commits.
- Nominatim: 1 req/s, identify with a User-Agent; never bulk-geocode — hence the dictionary + budget.

## 9. Backlog (owner-approved order where known)

**Auth (planned for 2026-09-05, owner-approved design)**
- OAuth only: Google + LinkedIn (no email/password, no magic links → no signup/reset emails). Anonymous sessions so "save job" works before sign-in.
- Tables: `profiles` (id = auth.uid, email, name, avatar, marketing_opt_in + _at + _source — opt-in unchecked by default, currently unused), `saved_jobs`, `job_alerts` (user_id, city_slug, category). Owner-only RLS via `auth.uid()`.
- Contextual alert checkbox bottom-right of the map for signed-in users: "Email me new {Role} jobs in {City}". Tapping while signed out opens sign-in. Worker sends a daily digest of NEW matching jobs via Resend free tier; unsubscribe link in every email + manage in settings.
- No promotional email until the owner decides otherwise; legal text for accounts/alerts already live at /terms and /privacy.
- Free-tier facts: 50,000 MAU on Supabase Auth; built-in email sender is ~4/hour (irrelevant with OAuth-only).

**Next / soon**
- Searchable city picker (dropdown is now long) + default city from visitor country (Vercel geo header)
- "Remote" pseudo-cities in the picker (remote roles currently pin to HQ with a badge)
- Fill `website` for the biggest harvest companies (turns monogram pins into logos)
- Per-city discovery scan (`discover --city "Pune,Mumbai,…"`) + weekly discovery workflow — designed, not built
- Logo pipeline: normalize to 64px WebP; immutable cache headers on `/logos/*`
- Hide pin labels below a zoom threshold if dense cities get cluttered
- Department/category rules tuning from the worker's `other` column

**Later**
- Tier 2 countries (PL, CZ, BR, MX, AR, CO, EE, RO, UA) — needs Portuguese/Spanish/Polish category rules
- Tier 3 (JP, KR, CN, TW) — needs new ATS adapters (HERP, Wantedly…) + language rules
- Regional ATS adapters that gate coverage: Keka/Zoho Recruit/Darwinbox (India), Comeet (Israel), Workday (enterprise: Disney, Snap, Riot, Northrop…)
- Real sign-in (Supabase Auth) → saved jobs, alerts. Sidebar shows a placeholder today.
- City landing pages `/jobs-in/[city]`; featured-pin monetization; Offerwall config after AdSense approval
- Optional: Supabase Storage for logos (`LOGO_TARGET=supabase`) — owner asked, current recommendation is to keep `public/`

## 10. Working conventions with the AI collaborator

- Deliverables are cumulative zips (`hire-la-final.zip`); replace the folder, keep `.env.local`, `npm install` only when dependencies changed, restart dev server on config/env changes.
- The AI cannot run a browser, Postgres, or reach ATS/OSM APIs from its sandbox: it typechecks and builds every drop, unit-tests pure logic offline, but **runtime UI/DB bugs surface on the owner's machine**. Fastest debug loop: send the **browser Console** and a **Network-tab filter** screenshot.
- Owner prefers: plan first for larger changes ("don't jump to code"), then one consolidated drop; concise explanations; honest caveats; monochrome/minimal UI; no fake UI (sign-in is an honest placeholder).
- Numbers shown in the UI must come from SQL aggregates, never from counting capped rows.
