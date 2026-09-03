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
import { canonicalCitySlug, matchCity } from '../lib/geo-dictionary';
import { pMap } from '../lib/pmap';

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

interface GeoHit { lat: number; lng: number; country?: string; countryCode?: string; region?: string }
const CACHE_PATH = 'scripts/.geocode-cache.json';
const cache: Record<string, GeoHit> = existsSync(CACHE_PATH)
  ? JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
  : {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geocode(address: string): Promise<GeoHit | null> {
  if (cache[address]?.country) return cache[address];
  await sleep(1100); // Nominatim policy: max 1 request/second
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { 'user-agent': 'hire-la-seed/1.0 (job map side project)' } });
  if (!res.ok) return null;
  const results = (await res.json()) as Array<{ lat: string; lon: string; address?: Record<string, string> }>;
  if (!results.length) return null;
  const a = results[0].address ?? {};
  const hit: GeoHit = {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    country: a.country,
    countryCode: a.country_code,
    region: a.state,
  };
  cache[address] = hit;
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  return hit;
}

/** Make sure the city exists in the selector (center = this office if the city is new). */
async function ensureCity(slug: string, name: string, geo: GeoHit) {
  const { data } = await db.from('cities').select('slug').eq('slug', slug).maybeSingle();
  if (data) return;
  await db.from('cities').insert({
    slug,
    name,
    region: geo.region ?? null,
    country: geo.country ?? 'Unknown',
    country_code: geo.countryCode ?? null,
    lng: geo.lng,
    lat: geo.lat,
    zoom: 11,
    source: 'seed',
  });
}

// ----------------------------------------------------------------------- Main

async function main() {
  const rows = parseCsv(readFileSync('companies.csv', 'utf8')) as unknown as CsvRow[];
  console.log(`companies.csv: ${rows.length} rows\n`);

  const summary: Array<{ name: string; token: string; jobs: string; geocode: string; db: string }> = [];

  // Validate every token first, 5 at a time.
  console.log('Validating tokens…');
  const checks = await pMap(rows, 5, async (row) => {
    if (!['greenhouse', 'lever', 'ashby'].includes(row.ats_type)) return { valid: false, jobCount: 0, detail: `unknown ats_type "${row.ats_type}"` };
    const c = await validateToken(row.ats_type, row.ats_token);
    console.log(`  ${row.name.padEnd(26)} ${row.ats_type}/${row.ats_token}: ${c.valid ? `ok, ${c.jobCount} live jobs` : `INVALID (${c.detail})`}`);
    return c;
  });

  for (const [i, row] of rows.entries()) {
    const line = { name: row.name, token: '', jobs: '-', geocode: '-', db: 'skipped' };
    summary.push(line);
    const check = checks[i];
    line.token = check.valid ? 'valid' : `INVALID (${check.detail})`;
    line.jobs = check.valid ? String(check.jobCount) : '-';
    if (!check.valid) continue;

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

    // No address? The company is in — the worker discovers its offices from job locations.
    if (!row.address) {
      line.geocode = '(worker discovers)';
      line.db = 'company upserted';
      continue;
    }

    // City-level address ("Long Beach, CA") that the dictionary knows → no geocoder call.
    const dict = /\d/.test(row.address) ? null : matchCity(row.address) ?? matchCity(row.city);
    let point: GeoHit | null = dict
      ? { lat: dict.lat, lng: dict.lng, country: dict.country, countryCode: dict.cc, region: dict.region }
      : null;
    if (!point) {
      process.stdout.write(`${row.name}: geocoding "${row.address}" ... `);
      point = await geocode(row.address);
      if (!point) {
        line.geocode = 'FAILED';
        console.log('FAILED — fix the address and re-run');
        line.db = 'company upserted, no location';
        continue;
      }
      console.log(`${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`);
    }
    line.geocode = dict ? `${dict.name} (dictionary)` : `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;

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

    const citySlug = dict?.slug ?? canonicalCitySlug(row.city || 'Unknown');
    await ensureCity(citySlug, dict?.name ?? row.city, point);

    const { error: lErr } = await db.from('locations').insert({
      company_id: company.id,
      label: row.is_hq === 'true' ? 'HQ' : row.city,
      address: row.address,
      city: row.city,
      city_slug: citySlug,
      geom: `SRID=4326;POINT(${point.lng} ${point.lat})`,
      is_hq: row.is_hq === 'true',
      // A street address (has a number) is exact; "Long Beach, CA" is a city-center placeholder.
      precision: /\d/.test(row.address) ? 'address' : 'city',
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
