# hire.la — build steps

The project is built in 15 verified steps. Each step ships as a cumulative zip; the next step starts only after the previous one passes verification. Backend → frontend → worker → launch, with fixture jobs bridging the gap so the frontend is built against realistic data before the worker exists.

| # | Status | Build | Verified by |
|---|--------|-------|-------------|
| 1 | ✅ verified | Repo skeleton: README, docs, migration SQL, companies.csv starter, .env.example | Migration runs in Supabase — tables appear |
| 2 | ✅ verified | seed.ts (token validation + Nominatim geocoding) + fixtures.ts (fake jobs) | Companies, locations, fixture jobs in DB |
| 3 | ✅ verified | Next.js scaffold, lib/ (types, clients, cities), /api/pins | npm run dev + curl — pins JSON returns |
| 4 | ✅ verified | Bare map: MapLibre + OpenFreeMap, dynamic import, gestures | LA map renders, pinch/pan works on phone |
| 5 | ✅ verified | Pins layer: markers with job counts, selected state, clustering | Seeded companies appear as tappable pins |
| 6 | ✅ verified | City selector: country→city dropdowns, flyTo, URL sync, empty state | Map flies between cities, URL updates |
| 7 | ✅ verified | Company panel: bottom sheet / side panel, job rows, apply links | Tap pin — company + fixture jobs render |
| 8 | ✅ verified | Filters + states: department chips, loading skeletons, error states | Filter persists across cities; graceful errors |
| 9 | ✅ verified | Home shell + responsive pass | Everything usable at 360px |
| 10 | ✅ verified | Greenhouse adapter standalone: fetch + normalize, prints results | Real jobs print as clean JSON in terminal |
| 11 | ✅ verified | Worker core: location matcher, slugs, upsert, deactivation, summary | Real jobs replace fixtures on the map |
| 12 | ✅ verified | Lever + Ashby adapters + GitHub Actions workflow | Manual workflow run on GitHub — green |
| 13 | ✅ verified | /jobs/[slug] + /company/[slug] ISR pages, JSON-LD | Job URL renders full page; closed-state works |
| 14 | ✅ verified | Sitemap, robots, metadata, about + privacy | /sitemap.xml lists every job |
| 15 | ✅ shipped | AdSlot, deploy config, launch checklist | Production deploy on hire.la |

All 15 steps shipped — the build is complete. Remaining actions are account-side and listed in LAUNCH.md.

Working agreement: every zip is the full project (delete the previous one), each ships with a verify checklist, and a failed verification means we stay on the step until it passes.
