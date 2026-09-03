# hire.la — launch checklist

Everything below is on your side of the fence (accounts, secrets, DNS). Total cost at launch: the domain. Everything else runs on free tiers.

## 1. Repository

- [ ] Push the final project to GitHub (`hire-la`, public repo recommended — public repos get unlimited Actions minutes)
- [ ] Confirm all three migrations have been run in Supabase (0001 schema, 0002 pins function, 0003 public read)
- [ ] Confirm `npm run seed` and `npm run worker` have both run clean locally

## 2. Worker on autopilot (GitHub Actions)

- [ ] Repo → Settings → Secrets and variables → Actions → add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Actions tab → fetch-jobs → Run workflow → confirm a green run with a sane summary
- [ ] Remember the quirk: GitHub pauses schedules after 60 days without repo activity — any commit resets it

## 3. Deploy (Vercel)

- [ ] vercel.com → Add New Project → import the GitHub repo (framework auto-detected: Next.js)
- [ ] Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (only these two — the service key never goes to Vercel)
- [ ] Deploy → smoke-test the `*.vercel.app` URL: map, pins, panel, a job page, /about, /sitemap.xml

## 4. Domain

- [ ] Buy `hire.la` (~$30–40/yr — the project's only recurring cost)
- [ ] Vercel → Project → Domains → add hire.la → follow the DNS instructions at your registrar
- [ ] Confirm https://hire.la serves the app (SSL is automatic)
- [ ] Update the contact email on /about and /privacy if you're not using hello@hire.la

## 5. Search (do this launch week — indexing takes time)

- [ ] Google Search Console → add the hire.la property (DNS verification)
- [ ] Submit https://hire.la/sitemap.xml
- [ ] After ~1–2 weeks: check `site:hire.la` returns job pages, and Search Console → Enhancements shows JobPosting structured data detected

## 6. Monetization (only after real traffic exists)

- [ ] Apply for AdSense with the live domain (the map alone looks "thin" to reviewers — the job/company/about pages are what carry the application)
- [ ] On approval: set `NEXT_PUBLIC_ADSENSE_ID` in Vercel env → redeploy → the dormant AdSlots on job and company pages go live
- [ ] Add the consent management setup AdSense requires (configure in AdSense → Privacy & messaging) and update /privacy accordingly
- [ ] Optionally configure Offerwall (AdSense → Privacy & messaging): generous threshold, ~10–15 page views per session, never on first views
- [ ] Sanity math: payouts start at $100; expect the first one to take a few months at early traffic

## 7. Growth loop (repeatable forever)

Adding a company: one row in `companies.csv` → `npm run seed` → next worker run picks up its jobs.
Adding a city: seed its companies + one entry in `lib/cities.ts` (+ a METRO mapping in `scripts/seed.ts` if the metro spans municipalities) → it appears in the dropdown.
Watching health: the Actions run summary shows per-company fetch counts and HQ-fallback rates — a company with a suddenly-failing fetch or high fallback deserves a look.

## Known future work (post-launch backlog)

City landing pages (`/jobs-in/[city]`) for organic entry traffic · `featured` flag on companies for paid highlighted pins · smarter location matching if fallback rates run high · a "Search this area" button if you ever want off-city browsing.
