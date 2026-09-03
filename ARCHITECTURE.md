# hire.la — Architecture

A map-first job discovery app. Companies are pinned on a city map; tapping a pin shows live openings pulled from each company's ATS (Greenhouse, Lever, Ashby). The system is designed around three constraints: $0 operating cost, SEO-friendly per-job pages that carry the monetization plan, and city-scoped data loading so user traffic barely touches the database.

## 1. System overview

Four runtime pieces, one language (TypeScript) across all of them.

| Piece | Technology | Runs on | Cost |
|---|---|---|---|
| Web app | Next.js (App Router) + MapLibre GL | Vercel free tier | $0 |
| Database | Postgres + PostGIS | Supabase free tier | $0 |
| Ingestion worker | TypeScript script via `tsx` | GitHub Actions (cron) | $0 |
| Map tiles | OpenFreeMap vector tiles | Their CDN, no key | $0 |

Data flows in one direction: the worker pulls jobs from ATS public APIs on a 12-hour schedule, normalizes them, matches them to office locations, and upserts into Postgres. The Next.js app reads from Postgres and never writes. Geocoding happens exactly once, at seed time, via Nominatim. There is no standalone API server — server components and route handlers inside Next.js query Supabase directly.

## 2. The city-scoped loading model

Map movement is free; data loading is deliberate. Users pan and pinch-zoom freely — MapLibre handles gestures, and street tiles stream from OpenFreeMap's CDN without involving our infrastructure. Job pins, by contrast, load once per city selection, not per viewport movement.

The app ships a static city registry in `lib/cities.ts` — entries like `{ country: "United States", city: "Los Angeles", slug: "los-angeles", center: [-118.24, 34.05], zoom: 10 }`. A cascading country → city selector drives `map.flyTo(center, zoom)`, and selecting a city triggers exactly one request: `GET /api/pins?city=los-angeles`. Because that response is identical for every user until the next worker run, it is cached at Vercel's edge — a thousand users browsing a city can cost a single database query. The selection syncs to the URL (`/?city=pune`) for shareable links, with Los Angeles as the default. Adding a city to the product is a data-only change: new rows in `companies.csv` plus one entry in `cities.ts`.

Zooming never refetches: clustering runs client-side (`supercluster`) over pins already in hand, splitting and merging as the zoom level changes. A city listed in the registry but not yet seeded shows an explicit "no companies here yet" empty state.

## 3. Repository layout

One repository, one Next.js project, with the worker and seed script alongside the app so they share types and clients.

```
hire-la/
├─ app/
│  ├─ layout.tsx                  Root layout, fonts, AdSlot mount point
│  ├─ page.tsx                    Home: server shell around the client map
│  ├─ company/[slug]/page.tsx     Company profile + openings (ISR)
│  ├─ jobs/[slug]/page.tsx        Single job page with JSON-LD (ISR)
│  ├─ api/pins/route.ts           GET pins for a city (edge-cached)
│  ├─ sitemap.ts                  Generated from companies + jobs
│  ├─ robots.ts
│  ├─ about/page.tsx              Static (AdSense requirement)
│  └─ privacy/page.tsx            Static (AdSense requirement)
├─ components/
│  ├─ JobMap.tsx                  'use client' — MapLibre, loaded with ssr:false
│  ├─ CitySelector.tsx            'use client' — country → city dropdowns
│  ├─ BottomSheet.tsx             'use client' — company panel (side panel on desktop)
│  ├─ JobRow.tsx                  Job list item: /jobs/[slug] link + apply URL
│  └─ FilterChips.tsx             'use client' — department filter
├─ lib/
│  ├─ supabase.ts                 Browser/server clients (anon key)
│  ├─ types.ts                    Company, OfficeLocation, Job, Pin
│  ├─ cities.ts                   Static city registry
│  └─ slug.ts                     Slug generation, shared by worker and app
├─ worker/
│  ├─ fetch-jobs.ts               Cron entry: loop companies → sync
│  ├─ ats/greenhouse.ts           Adapter
│  ├─ ats/lever.ts                Adapter
│  ├─ ats/ashby.ts                Adapter
│  └─ match-location.ts           Job location string → locations row
├─ scripts/
│  ├─ seed.ts                     companies.csv → validate tokens → geocode → insert
│  └─ fixtures.ts                 Fake jobs for frontend development
├─ supabase/migrations/0001_init.sql
├─ .github/workflows/fetch-jobs.yml
├─ companies.csv
└─ .env.example
```

## 4. Data model

Three tables. Companies and locations are slow data, seeded once and edited rarely. Jobs are fast data, owned entirely by the worker. Full DDL in `supabase/migrations/0001_init.sql`.

Design notes. The `unique (company_id, source_job_id)` constraint makes the worker idempotent: every run is a pure upsert, safe to re-run at any time. The `slug` columns exist because URLs are a product surface — `/jobs/sunset-labs-frontend-engineer-santa-monica` is human-readable and keyword-rich; slugs are generated once at insert so URLs never change when titles get edited. `locations.city_slug` is the pins query key, indexed, matching `cities.ts` slugs — the hot path is a plain indexed lookup, with PostGIS retained for coordinate storage and future spatial features. `workplace_type` implements the remote-jobs decision: remote jobs pin to HQ and carry a badge. `description_html` is stored because per-job pages need real content for SEO and AdSense; Greenhouse and Lever both return it.

Row Level Security is enabled on all three tables: public `select` (jobs only where `is_active`), no public writes. The worker and seed script use the service-role key, which bypasses RLS and never ships to the browser.

## 5. Ingestion worker

A plain TypeScript script executed by `npx tsx worker/fetch-jobs.ts` inside a GitHub Actions job — no server, no queue, no state beyond the database.

Every ATS adapter implements one signature, so ATS #4 is a single new file:

```ts
export interface NormalizedJob {
  sourceJobId: string;
  title: string;
  department?: string;
  locationText: string;        // raw string from the ATS, e.g. "Santa Monica, CA"
  applyUrl: string;
  descriptionHtml?: string;
  postedAt?: string;
  workplaceType?: 'onsite' | 'hybrid' | 'remote';
}

export type AtsAdapter = (token: string) => Promise<NormalizedJob[]>;
```

The endpoints are the free public ones, no keys required:

| ATS | Endpoint |
|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` |
| Lever | `https://api.lever.co/v0/postings/{token}?mode=json` |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{token}` |

Per company, a sync run calls the adapter for the company's `ats_type`, passes each job's `locationText` through `match-location.ts` (lowercased city match against the company's `locations`, HQ fallback, remote detection), generates slugs for new jobs only, and upserts on `(company_id, source_job_id)`, always stamping `last_seen_at = run_start`. A failure in one company's fetch is caught, logged, and skipped — one broken board never aborts the run.

After the loop, one statement retires everything the run didn't see:

```sql
update jobs set is_active = false
where last_seen_at < :run_start and is_active;
```

Closed positions leave the map with no deletion tracking. Rows are kept, not deleted, so job pages render a "position closed" state instead of a 404, preserving accumulated SEO value.

The workflow (`.github/workflows/fetch-jobs.yml`) runs at 03:00 and 15:00 UTC plus `workflow_dispatch` for manual runs, with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as repository secrets. The twice-daily schedule doubles as the keep-alive preventing the Supabase free project from pausing. Known quirk: GitHub disables schedules after 60 days without repo activity; any commit resets the clock.

## 6. Web app

### Rendering strategy per route

| Route | Strategy | Why |
|---|---|---|
| `/` (map) | Server shell + client island | Map is client-side; shell carries metadata and intro copy |
| `/company/[slug]` | ISR, revalidate 21600s | Crawlable HTML, regenerates after worker runs |
| `/jobs/[slug]` | ISR, revalidate 21600s | Same; carries JSON-LD |
| `/api/pins` | Route handler, `s-maxage=300` | One cache entry per city |
| `/about`, `/privacy` | Static | AdSense approval requirements |
| `/sitemap.xml` | Generated from DB | Feeds Google every job and company URL |

ISR means job and company pages are built once, served as static HTML, and rebuilt in the background after the revalidate window — traffic spikes hit cached HTML, not the database, which is what keeps real usage inside both free tiers.

### The pins endpoint

`GET /api/pins?city=los-angeles&dept=Engineering` runs one indexed query: locations joined to companies, left-joined to active jobs (optionally filtered by department), grouped to per-office counts, returned as a compact JSON FeatureCollection the map consumes directly.

### Job pages and structured data

Every `/jobs/[slug]` page embeds a `JobPosting` JSON-LD block (title, org, address with real coordinates, posted date, apply URL), making listings eligible for the Google for Jobs panel — for a job site, a larger organic channel than classic blue links. `generateMetadata` produces per-page titles and descriptions. Inactive jobs render a closed-position notice plus the company's other openings, keeping the URL alive.

## 7. Configuration and secrets

| Variable | Where it lives | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel env + `.env.local` | App (browser + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env + `.env.local` | App, read-only via RLS |
| `SUPABASE_URL` | GitHub Actions secret + `.env.local` | Worker, seed script |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions secret + `.env.local` | Worker, seed script — never Vercel, never the browser |

The split is the security model in miniature: the browser can only read what RLS allows; the only credentials that can write live in GitHub's secret store and exist for the duration of a cron run.

## 8. Monetization and growth hooks

Slots are reserved from day one, activated later. The layout has a single `AdSlot` component that renders nothing until `NEXT_PUBLIC_ADSENSE_ID` exists, so enabling AdSense after approval is a config change, not a refactor. Offerwall is configured inside AdSense with zero code. The sitemap, ISR pages, and JSON-LD are the organic-traffic engine and exist from the first deploy. City landing pages (`/jobs-in/[city]`) are the planned organic entry points as cities expand. A later `featured` boolean on companies is the entire schema change needed for paid highlighted pins.
