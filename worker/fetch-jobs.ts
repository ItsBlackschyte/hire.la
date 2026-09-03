/**
 * hire.la ingestion worker — the cron entry point.
 *
 *   npm run worker            (locally)
 *   npx tsx worker/fetch-jobs.ts   (GitHub Actions, step 12)
 *
 * Per company: fetch the live board via its ATS adapter, match each job to
 * an office, upsert on (company_id, source_job_id) stamping last_seen_at.
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
import { matchLocation, type OfficeRow } from './match-location';
import { jobSlug } from '../lib/slug';

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
  locations: OfficeRow[];
}

interface CompanyStats {
  name: string;
  status: string;
  fetched: number;
  inserted: number;
  updated: number;
  fallbackMatched: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function syncCompany(company: CompanyRow, runStart: string): Promise<CompanyStats> {
  const stats: CompanyStats = {
    name: company.name,
    status: 'ok',
    fetched: 0,
    inserted: 0,
    updated: 0,
    fallbackMatched: 0,
  };

  const adapter = ADAPTERS[company.ats_type];
  if (!adapter) {
    stats.status = `skipped (no adapter for "${company.ats_type}")`;
    return stats;
  }
  if (company.locations.length === 0) {
    stats.status = 'skipped (no locations seeded)';
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

  const cityById = new Map(company.locations.map((l) => [l.id, l.city]));

  const rows = jobs.map((job) => {
    const match = matchLocation(job.locationText, company.locations);
    if (match.fallback) stats.fallbackMatched++;

    let slug = existingBySource.get(job.sourceJobId);
    if (!slug) {
      const city = (match.locationId && cityById.get(match.locationId)) || 'la';
      const base = jobSlug(company.slug, job.title, city);
      slug = base;
      for (let n = 2; takenSlugs.has(slug); n++) slug = `${base}-${n}`;
      takenSlugs.add(slug);
      stats.inserted++;
    } else {
      stats.updated++;
    }

    return {
      company_id: company.id,
      location_id: match.locationId,
      slug,
      source_job_id: job.sourceJobId,
      title: job.title,
      department: job.department ?? null,
      employment_type: job.employmentType ?? null,
      workplace_type: job.workplaceType ?? (match.remote ? ('remote' as const) : null),
      apply_url: job.applyUrl,
      description_html: job.descriptionHtml ?? null,
      posted_at: job.postedAt ?? null,
      last_seen_at: runStart,
      is_active: true,
    };
  });

  for (const batch of chunk(rows, 100)) {
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
    .select('id, slug, name, ats_type, ats_token, locations ( id, city, is_hq )')
    .order('name');
  if (error) throw error;
  if (!companies || companies.length === 0) {
    console.error('No companies — run `npm run seed` first.');
    process.exit(1);
  }

  const results: CompanyStats[] = [];
  const okCompanyIds: string[] = [];

  for (const company of companies as unknown as CompanyRow[]) {
    process.stdout.write(`${company.name} (${company.ats_type}/${company.ats_token}) ... `);
    try {
      const stats = await syncCompany(company, runStart);
      results.push(stats);
      if (stats.status === 'ok') {
        okCompanyIds.push(company.id);
        console.log(`${stats.fetched} jobs (${stats.inserted} new, ${stats.updated} updated)`);
      } else {
        console.log(stats.status);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name: company.name, status: `FAILED: ${msg}`, fetched: 0, inserted: 0, updated: 0, fallbackMatched: 0 });
      console.log(`FAILED: ${msg}`);
    }
  }

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
        ? `fetched ${String(r.fetched).padStart(3)}  new ${String(r.inserted).padStart(3)}  updated ${String(r.updated).padStart(3)}  hq-fallback ${r.fallbackMatched}`
        : r.status;
    console.log(`${r.name.padEnd(20)} ${line}`);
  }
  console.log('-----------------------------------------------------');
  console.log(`companies ok: ${okCompanyIds.length}/${companies.length}`);
  console.log(`jobs upserted: ${totalUpserted}, deactivated: ${deactivated}, fixtures removed: ${fixturesDeleted}`);
  console.log(`run finished ${new Date().toISOString()}`);

  // Non-zero exit if every single company failed — lets CI flag a dead run.
  if (okCompanyIds.length === 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
