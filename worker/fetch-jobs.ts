/**
 * hire.la ingestion worker — the cron entry point.
 *
 *   npm run worker            (locally)
 *   npx tsx worker/fetch-jobs.ts   (GitHub Actions)
 *
 * Env: GEOCODE_BUDGET (default 800), WORKER_CONCURRENCY (default 5), POI_LOOKUP=1 to look up real offices in OSM.
 *
 * Per company: fetch the live board via its ATS adapter, resolve each job's
 * location to an office row (discovering cities as needed — see
 * resolve-location.ts), upsert on (company_id, source_job_id) stamping
 * last_seen_at.
 * A failure in one company is logged and skipped — never aborts the run.
 *
 * Afterwards, jobs not seen this run are deactivated — but ONLY for
 * companies whose fetch succeeded, so a temporarily broken board never
 * mass-deactivates its own jobs. Fixture jobs are deleted once the run
 * has inserted real data.
 *
 * Idempotent and safe to re-run at any time. Slugs are generated once for
 * new jobs and never regenerated, so URLs stay stable.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { greenhouse } from './ats/greenhouse';
import { lever } from './ats/lever';
import { ashby } from './ats/ashby';
import type { AtsAdapter, NormalizedJob } from './ats/types';
import { LocationResolver } from './resolve-location';
import { jobSlug } from '../lib/slug';
import { categorize } from '../lib/categorize';
import { pMap } from '../lib/pmap';

config({ path: '.env.local' });
config();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const ADAPTERS: Partial<Record<string, AtsAdapter>> = {
  greenhouse,
  lever,
  ashby,
};

interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  ats_type: string;
  ats_token: string;
}

interface CompanyStats {
  name: string;
  status: string;
  fetched: number;
  inserted: number;
  updated: number;
  fallbackMatched: number;
  uncategorized: number;
  newCities: number;
  newLocations: number;
  excluded: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function syncCompany(company: CompanyRow, runStart: string, resolver: LocationResolver): Promise<CompanyStats> {
  const stats: CompanyStats = {
    name: company.name,
    status: 'ok',
    fetched: 0,
    inserted: 0,
    updated: 0,
    fallbackMatched: 0,
    uncategorized: 0,
    newCities: 0,
    newLocations: 0,
    excluded: 0,
  };

  const adapter = ADAPTERS[company.ats_type];
  if (!adapter) {
    stats.status = `skipped (no adapter for "${company.ats_type}")`;
    return stats;
  }
  const jobs: NormalizedJob[] = await adapter(company.ats_token);
  stats.fetched = jobs.length;

  // Existing jobs: preserve their slugs, count insert-vs-update.
  const { data: existingRows, error: exErr } = await db
    .from('jobs')
    .select('source_job_id, slug')
    .eq('company_id', company.id);
  if (exErr) throw new Error(`reading existing jobs: ${exErr.message}`);

  const existingBySource = new Map((existingRows ?? []).map((r) => [r.source_job_id, r.slug]));
  const takenSlugs = new Set((existingRows ?? []).map((r) => r.slug));

  const rows = [];
  for (const job of jobs) {
    const match = await resolver.resolve(company, job.locationText);
    if (match.excluded) {
      stats.excluded++;
      continue; // outside the allowed countries → not stored
    }
    if (match.fallback) stats.fallbackMatched++;
    if (match.createdCity) stats.newCities++;
    if (match.createdLocation) stats.newLocations++;

    let slug = existingBySource.get(job.sourceJobId);
    if (!slug) {
      const city = match.citySlug ?? 'remote';
      const base = jobSlug(company.slug, job.title, city);
      slug = base;
      for (let n = 2; takenSlugs.has(slug); n++) slug = `${base}-${n}`;
      takenSlugs.add(slug);
      stats.inserted++;
    } else {
      stats.updated++;
    }

    const category = categorize(job.title, job.department);
    if (category === 'Other') stats.uncategorized++;

    rows.push({
      company_id: company.id,
      location_id: match.locationId,
      slug,
      source_job_id: job.sourceJobId,
      title: job.title,
      department: job.department ?? null,
      category,
      employment_type: job.employmentType ?? null,
      workplace_type: job.workplaceType ?? (match.remote ? ('remote' as const) : null),
      apply_url: job.applyUrl,
      posted_at: job.postedAt ?? null,
      last_seen_at: runStart,
      is_active: true,
    });
  }

  for (const batch of chunk(rows, 500)) {
    const { error } = await db
      .from('jobs')
      .upsert(batch, { onConflict: 'company_id,source_job_id' });
    if (error) throw new Error(`upsert: ${error.message}`);
  }

  return stats;
}

async function main() {
  const runStart = new Date().toISOString();
  console.log(`hire.la worker — run started ${runStart}\n`);

  const { data: companies, error } = await db
    .from('companies')
    .select('id, slug, name, ats_type, ats_token')
    .order('name');
  if (error) throw error;
  if (!companies || companies.length === 0) {
    console.error('No companies — run `npm run seed` first.');
    process.exit(1);
  }

  const resolver = new LocationResolver(db);
  await resolver.load();

  const okCompanyIds: string[] = [];
  const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);

  const results = await pMap(companies as unknown as CompanyRow[], CONCURRENCY, async (company) => {
    try {
      const stats = await syncCompany(company, runStart, resolver);
      if (stats.status === 'ok') {
        okCompanyIds.push(company.id);
        console.log(`${company.name}: ${stats.fetched} jobs (${stats.inserted} new, ${stats.updated} updated${stats.excluded ? `, ${stats.excluded} outside scope` : ''})`);
      } else {
        console.log(`${company.name}: ${stats.status}`);
      }
      return stats;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`${company.name}: FAILED: ${msg}`);
      return { name: company.name, status: `FAILED: ${msg}`, fetched: 0, inserted: 0, updated: 0, fallbackMatched: 0, uncategorized: 0, newCities: 0, newLocations: 0, excluded: 0 } as CompanyStats;
    }
  });

  // Deactivate stale jobs — only for companies that synced successfully.
  let deactivated = 0;
  for (const ids of chunk(okCompanyIds, 50)) {
    const { data, error: dErr } = await db
      .from('jobs')
      .update({ is_active: false })
      .in('company_id', ids)
      .lt('last_seen_at', runStart)
      .eq('is_active', true)
      .not('source_job_id', 'like', 'fixture-%')
      .select('id');
    if (dErr) console.error(`deactivation error: ${dErr.message}`);
    else deactivated += data?.length ?? 0;
  }

  // Retire fixtures once real data exists.
  const totalUpserted = results.reduce((s, r) => s + r.inserted + r.updated, 0);
  let fixturesDeleted = 0;
  if (totalUpserted > 0) {
    const { data: fx, error: fxErr } = await db
      .from('jobs')
      .delete()
      .like('source_job_id', 'fixture-%')
      .select('id');
    if (fxErr) console.error(`fixture cleanup error: ${fxErr.message}`);
    else fixturesDeleted = fx?.length ?? 0;
  }

  console.log('\n==================== RUN SUMMARY ====================');
  for (const r of results) {
    const line =
      r.status === 'ok'
        ? `fetched ${String(r.fetched).padStart(4)}  new ${String(r.inserted).padStart(4)}  updated ${String(r.updated).padStart(4)}  hq-fallback ${String(r.fallbackMatched).padStart(3)}  outside-scope ${String(r.excluded).padStart(3)}  other ${String(r.uncategorized).padStart(3)}  +cities ${r.newCities}  +offices ${r.newLocations}`
        : r.status;
    console.log(`${r.name.padEnd(20)} ${line}`);
  }
  console.log('-----------------------------------------------------');
  console.log(`companies ok: ${okCompanyIds.length}/${companies.length}`);
  console.log(`geocoding: ${resolver.geocodeCalls} lookups this run${resolver.deferred ? `, ${resolver.deferred} deferred to the next run (budget ${process.env.GEOCODE_BUDGET ?? 800})` : ''}`);
  console.log(`jobs upserted: ${totalUpserted}, deactivated: ${deactivated}, fixtures removed: ${fixturesDeleted}`);
  console.log(`run finished ${new Date().toISOString()}`);

  // Non-zero exit if every single company failed — lets CI flag a dead run.
  if (okCompanyIds.length === 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
