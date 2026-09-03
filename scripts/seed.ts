/**
 * hire.la seed script
 *
 * Reads companies.csv, then for every row:
 *   1. Validates the ATS token against the live public API
 *      (invalid tokens are reported and skipped — nothing broken enters the DB)
 *   2. Geocodes the address via Nominatim (1 req/sec policy, results cached
 *      in scripts/.geocode-cache.json so re-runs are instant)
 *   3. Upserts the company (idempotent on slug) and inserts its location
 *      (skipped if the same company+address already exists)
 *
 * Run:  npm run seed
 * Safe to re-run at any time.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { slugify } from '../lib/slug';
import { parseCsv } from '../lib/csv';

config({ path: '.env.local' });
config();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---------------------------------------------------------------- CSV shape

interface CsvRow {
  name: string;
  website: string;
  ats_type: 'greenhouse' | 'lever' | 'ashby';
  ats_token: string;
  address: string;
  city: string;
  is_hq: string;
  verified: string;
}

// ------------------------------------------------------- ATS token validation

interface TokenCheck { valid: boolean; jobCount: number; detail: string }

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function validateToken(ats: CsvRow['ats_type'], token: string): Promise<TokenCheck> {
  try {
    if (ats === 'greenhouse') {
      const j = (await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`)) as { jobs?: unknown[] };
      if (!Array.isArray(j.jobs)) return { valid: false, jobCount: 0, detail: 'unexpected response shape' };
      return { valid: true, jobCount: j.jobs.length, detail: 'ok' };
    }
    if (ats === 'lever') {
      const j = await fetchJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
      if (!Array.isArray(j)) return { valid: false, jobCount: 0, detail: 'unexpected response shape' };
      return { valid: true, jobCount: j.length, detail: 'ok' };
    }
    const j = (await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${token}`)) as { jobs?: unknown[] };
    if (!Array.isArray(j.jobs)) return { valid: false, jobCount: 0, detail: 'unexpected response shape' };
    return { valid: true, jobCount: j.jobs.length, detail: 'ok' };
  } catch (err) {
    return { valid: false, jobCount: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ------------------------------------------------------------------ Geocoding

const CACHE_PATH = 'scripts/.geocode-cache.json';
const cache: Record<string, { lat: number; lng: number }> = existsSync(CACHE_PATH)
  ? JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
  : {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  if (cache[address]) return cache[address];
  await sleep(1100); // Nominatim policy: max 1 request/second
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { 'user-agent': 'hire-la-seed/1.0 (job map side project)' } });
  if (!res.ok) return null;
  const results = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!results.length) return null;
  const hit = { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  cache[address] = hit;
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  return hit;
}

// ----------------------------------------------------------------------- Main

async function main() {
  const rows = parseCsv(readFileSync('companies.csv', 'utf8')) as unknown as CsvRow[];
  console.log(`companies.csv: ${rows.length} rows\n`);

  const summary: Array<{ name: string; token: string; jobs: string; geocode: string; db: string }> = [];

  for (const row of rows) {
    const line = { name: row.name, token: '', jobs: '-', geocode: '-', db: 'skipped' };
    summary.push(line);

    if (!['greenhouse', 'lever', 'ashby'].includes(row.ats_type)) {
      line.token = `unknown ats_type "${row.ats_type}"`;
      continue;
    }

    process.stdout.write(`${row.name}: validating ${row.ats_type}/${row.ats_token} ... `);
    const check = await validateToken(row.ats_type, row.ats_token);
    line.token = check.valid ? 'valid' : `INVALID (${check.detail})`;
    line.jobs = check.valid ? String(check.jobCount) : '-';
    console.log(check.valid ? `ok, ${check.jobCount} live jobs` : `FAILED (${check.detail})`);
    if (!check.valid) continue;

    process.stdout.write(`${row.name}: geocoding "${row.address}" ... `);
    const point = await geocode(row.address);
    if (!point) {
      line.geocode = 'FAILED';
      console.log('FAILED — fix the address and re-run');
      continue;
    }
    line.geocode = `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
    console.log(line.geocode);

    const companySlug = slugify(row.name);
    const { data: company, error: cErr } = await db
      .from('companies')
      .upsert(
        {
          slug: companySlug,
          name: row.name,
          website: row.website || null,
          ats_type: row.ats_type,
          ats_token: row.ats_token,
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single();
    if (cErr || !company) {
      line.db = `company error: ${cErr?.message}`;
      continue;
    }

    const { data: existing } = await db
      .from('locations')
      .select('id')
      .eq('company_id', company.id)
      .eq('address', row.address)
      .maybeSingle();

    if (existing) {
      line.db = 'already seeded';
      continue;
    }

    const { error: lErr } = await db.from('locations').insert({
      company_id: company.id,
      label: row.is_hq === 'true' ? 'HQ' : row.city,
      address: row.address,
      city: row.city,
      city_slug: cityGroupSlug(row.city),
      geom: `SRID=4326;POINT(${point.lng} ${point.lat})`,
      is_hq: row.is_hq === 'true',
    });
    line.db = lErr ? `location error: ${lErr.message}` : 'inserted';
  }

  console.log('\n================= SEED SUMMARY =================');
  for (const s of summary) {
    console.log(`${s.name.padEnd(20)} token: ${s.token.padEnd(28)} jobs: ${s.jobs.padEnd(5)} geo: ${s.geocode.padEnd(20)} db: ${s.db}`);
  }
  console.log('================================================');
  console.log('Invalid tokens? Fix or remove those rows in companies.csv and re-run — valid rows are untouched.');
}

/**
 * Metro grouping: every LA-area municipality (Santa Monica, Hawthorne,
 * Glendale, ...) maps to the "los-angeles" city_slug so one dropdown
 * selection loads the whole metro. Extend this map as cities are added.
 */
const METRO: Record<string, string> = {
  'hawthorne': 'los-angeles',
  'long beach': 'los-angeles',
  'santa monica': 'los-angeles',
  'culver city': 'los-angeles',
  'glendale': 'los-angeles',
  'marina del rey': 'los-angeles',
  'los angeles': 'los-angeles',
  'west hollywood': 'los-angeles',
  'costa mesa': 'los-angeles',
  'el segundo': 'los-angeles',
  'burbank': 'los-angeles',
  'pasadena': 'los-angeles',
  'irvine': 'los-angeles',
  'venice': 'los-angeles',
};

function cityGroupSlug(city: string): string {
  return METRO[city.trim().toLowerCase()] ?? slugify(city);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
