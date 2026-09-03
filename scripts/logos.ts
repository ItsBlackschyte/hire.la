/**
 * hire.la logo fetcher
 *
 * For every company with a website, fetch a logo ONCE and save it to
 * public/logos/<slug>.png (served by Vercel's CDN — no runtime dependency on
 * any logo service). Then set companies.logo_url = "/logos/<slug>.png".
 *
 * Sources, in order:
 *   0. a `logo` URL in companies.csv (e.g. YC directory thumbnails from discover)
 *   1. Logo.dev  — if LOGO_DEV_TOKEN is set (free tier, best quality)
 *   2. Google favicon service — keyless fallback (decent at 128px)
 * Tiny responses (< 600 bytes) are treated as "no logo" placeholders.
 *
 * Run:  npm run logos            (skips companies that already have a logo)
 *       npm run logos -- --force (re-fetch everything)
 * Commit the resulting public/logos/ files.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { parseCsv } from '../lib/csv';
import { slugify } from '../lib/slug';
import { pMap } from '../lib/pmap';

config({ path: '.env.local' });
config();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOGO_DEV_TOKEN = process.env.LOGO_DEV_TOKEN;
const FORCE = process.argv.includes('--force');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function domainOf(website: string): string | null {
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'hire-la-logos/1.0' } });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length < 600 ? null : buf; // tiny = placeholder/default icon
  } catch {
    return null;
  }
}

async function main() {
  const { data: companies, error } = await db
    .from('companies')
    .select('id, slug, name, website, logo_url')
    .order('name');
  if (error) throw error;

  mkdirSync('public/logos', { recursive: true });

  // Optional per-company logo URLs from companies.csv
  const csvLogo = new Map<string, string>();
  if (existsSync('companies.csv')) {
    for (const r of parseCsv(readFileSync('companies.csv', 'utf8'))) {
      if (r.logo) csvLogo.set(slugify(r.name), r.logo);
    }
  }
  let saved = 0;
  let skipped = 0;
  let missing = 0;

  await pMap(companies ?? [], 5, async (c) => {
    if (c.logo_url && !FORCE) {
      skipped++;
      return;
    }
    const domain = c.website ? domainOf(c.website) : null;
    if (!domain) {
      console.log(`${c.name.padEnd(22)} no website — monogram fallback`);
      missing++;
      return;
    }

    const sources: Array<[string, string]> = [];
    const fromCsv = csvLogo.get(c.slug);
    if (fromCsv) sources.push(['csv', fromCsv]);
    if (LOGO_DEV_TOKEN) {
      sources.push(['logo.dev', `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&size=128&format=png`]);
    }
    sources.push(['google', `https://www.google.com/s2/favicons?domain=${domain}&sz=128`]);

    let done = false;
    for (const [name, url] of sources) {
      const buf = await fetchImage(url);
      if (!buf) continue;
      const file = `public/logos/${c.slug}.png`;
      writeFileSync(file, buf);
      const { error: uErr } = await db.from('companies').update({ logo_url: `/logos/${c.slug}.png` }).eq('id', c.id);
      console.log(`${c.name.padEnd(22)} ${name.padEnd(8)} ${(buf.length / 1024).toFixed(1).padStart(6)} KB → ${file}${uErr ? `  (DB error: ${uErr.message})` : ''}`);
      saved++;
      done = true;
      break;
    }
    if (!done) {
      console.log(`${c.name.padEnd(22)} no logo found for ${domain} — monogram fallback`);
      missing++;
    }
  });

  console.log(`\nsaved ${saved}, skipped ${skipped} (already had a logo), no logo ${missing}`);
  console.log(existsSync('public/logos') ? 'Commit public/logos/ so Vercel serves the files.' : '');
  if (!LOGO_DEV_TOKEN) {
    console.log('Tip: set LOGO_DEV_TOKEN in .env.local (free at logo.dev) and re-run with --force for higher-quality logos.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
