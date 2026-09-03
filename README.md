# hire.la

Map-first job discovery. Companies are pinned on a city map; tapping a pin shows live openings pulled from each company's ATS (Greenhouse, Lever, Ashby). Built to run entirely on free-tier infrastructure.

**Stack:** Next.js (TypeScript) on Vercel · Supabase (Postgres + PostGIS) · GitHub Actions ingestion worker · MapLibre GL + OpenFreeMap tiles · Nominatim geocoding (seed-time only).

Read `ARCHITECTURE.md` for the full system design and `STEPS.md` for the build-and-verify plan this repo follows.

## Repository contents

```
hire-la/
├─ README.md / ARCHITECTURE.md / STEPS.md
├─ companies.csv                   Seed list (validated by seed script)
├─ package.json                    Next.js app + scripts
├─ next.config.ts / tsconfig.json / eslint.config.mjs
├─ .env.example
├─ app/
│  ├─ layout.tsx                   Root layout + metadata
│  ├─ page.tsx                     Placeholder shell (map arrives step 4)
│  ├─ globals.css                  Design tokens + base styles
│  └─ api/pins/route.ts            GET /api/pins?city=&dept= (edge-cached)
├─ lib/
│  ├─ types.ts                     Company, OfficeLocation, Job, Pin
│  ├─ supabase.ts                  Anon-key clients (read-only via RLS)
│  ├─ cities.ts                    City registry (selector + flyTo targets)
│  └─ slug.ts                      Slug helpers
├─ scripts/
│  ├─ seed.ts                      CSV → validate tokens → geocode → insert
│  └─ fixtures.ts                  Fake jobs for frontend development
└─ supabase/migrations/
   ├─ 0001_init.sql                Schema, indexes, RLS
   └─ 0002_pins_function.sql       pins_for_city() RPC
```

## Commands

```
npm install          # once
npm run seed         # validate tokens, geocode, insert companies + locations (idempotent)
npm run fixtures     # insert fake jobs for frontend dev (idempotent; worker removes them)
npm run ats          # smoke-test ATS boards from companies.csv (no DB writes)
npm run worker       # full ingestion run: fetch, upsert, deactivate stale
npm run dev          # start the app on http://localhost:3000
npm run build        # production build
npm run typecheck    # tsc --noEmit
```

Launching? Follow `LAUNCH.md` — it walks from `git push` to a live, monetizable hire.la.

The seed script prints a per-company summary: token validity, live job count on the board, geocoded coordinates, and what happened in the database. Rows with invalid tokens are skipped, never inserted — fix or remove them in `companies.csv` and re-run. Geocoding results are cached in `scripts/.geocode-cache.json` (gitignored), so re-runs skip Nominatim entirely.

Note on `city_slug`: seed groups every LA-area municipality (Santa Monica, Hawthorne, Glendale...) under the single `los-angeles` metro slug via the `METRO` map in `seed.ts`, so one dropdown selection loads the whole metro. Extend that map when adding new metros.

## Setup

Follow `SETUP.md` — the complete runbook from `npm install` to a live deployment, including all three database migrations, seeding, the worker, and troubleshooting. `LAUNCH.md` covers domain, search, and monetization.

## About companies.csv

These are candidate LA-area companies believed to use Greenhouse, Lever, or Ashby. The `verified` column is `no` for all of them on purpose: ATS tokens change, and every token must be confirmed against the live API before seeding. The Step 2 seed script validates each token automatically and reports failures — you can also check any of them manually in a browser:

- Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{token}/jobs`
- Lever: `https://api.lever.co/v0/postings/{token}?mode=json`
- Ashby: `https://api.ashbyhq.com/posting-api/job-board/{token}`

JSON with jobs = valid token (flip `verified` to `yes`). An error page = wrong token or different ATS (fix the token or delete the row). Add your own rows freely — the columns are `name, website, ats_type, ats_token, address, city, is_hq, verified`, and one row = one office (a company with two offices gets two rows, `is_hq` true on exactly one).

Addresses only need to be geocodable — street-level where known, "City, CA" otherwise (the pin lands at the city center; refine the address later if you want pin-perfect placement).

## Environment variables

| Variable | Used by | Where to set |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web app | `.env.local`, later Vercel |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web app (read-only via RLS) | `.env.local`, later Vercel |
| `SUPABASE_URL` | seed script, worker | `.env.local`, later GitHub Actions secrets |
| `SUPABASE_SERVICE_ROLE_KEY` | seed script, worker (bypasses RLS) | `.env.local`, later GitHub Actions secrets — never Vercel, never the browser |
