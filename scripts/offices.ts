/**
 * hire.la office finder
 *
 * Upgrades placeholder locations (precision = 'city') to real office
 * positions using free sources, in order of precision:
 *
 *   1. wikidata — the company's HQ: exact coordinates or a street address,
 *      looked up by official website (P856). Established companies mostly.
 *   2. website  — the company's own site: schema.org Organization address
 *      blocks, plus contact/about/locations pages, keeping only addresses
 *      that name the city we're placing. Works for many startups and for
 *      non-HQ offices too.
 *   3. osm      — OpenStreetMap office lookup near the city (existing logic).
 *
 * Every candidate is geocoded/verified to lie within 60 km of the city
 * center before it's accepted; nothing is guessed. Placements that fail
 * stay as placeholders (near the center) and are retried after 60 days.
 *
 *   npm run offices                         all placeholder locations
 *   npm run offices -- --hq-only            HQ rows only (fastest, biggest win)
 *   npm run offices -- --sources wikidata,website
 *   npm run offices -- --limit 200 --company spacex --dry
 *
 * Google search results are not used: scraping them violates Google's terms
 * and gets blocked; Wikidata is where that HQ knowledge comes from anyway.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { pMap } from '../lib/pmap';
import { matchCity } from '../lib/geo-dictionary';
import { findCompanyPoi, geocodeAddress } from '../worker/geocode';

config({ path: '.env.local' });
config();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag('--dry');
const HQ_ONLY = flag('--hq-only');
const LIMIT = Number(opt('--limit') ?? '0') || Infinity;
const ONLY_COMPANY = opt('--company');
const SOURCES = new Set((opt('--sources') ?? 'wikidata,website,osm').split(','));
const RETRY_AFTER_DAYS = 60;
const MAX_KM = 60;

interface Row {
  id: string;
  is_hq: boolean;
  city: string;
  city_slug: string;
  companies: { slug: string; name: string; website: string | null };
}
interface Found { lat: number; lng: number; address: string; source: 'wikidata' | 'website' | 'osm'; precision: 'address' | 'poi' }

const UA = 'hire-la-offices/1.0 (job map; hello@hire.la)';
const kmBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));

// ------------------------------------------------------------------ wikidata

let lastWd = 0;
async function wikidataHQ(website: string, city: { lat: number; lng: number; name: string }): Promise<Found | null> {
  let host: string;
  try { host = new URL(website).hostname.replace(/^www\./, ''); } catch { return null; }
  const variants = [`https://${host}`, `https://${host}/`, `https://www.${host}`, `https://www.${host}/`, `http://${host}`, `http://${host}/`, `http://www.${host}`, `http://www.${host}/`];
  const values = variants.map((v) => `<${v}>`).join(' ');
  const sparql = `
    SELECT ?coord ?street ?ownCoord ?hqLabel WHERE {
      VALUES ?site { ${values} }
      ?item wdt:P856 ?site .
      OPTIONAL { ?item wdt:P625 ?ownCoord . }
      OPTIONAL { ?item p:P159 ?st . ?st ps:P159 ?hq .
                 OPTIONAL { ?st pq:P625 ?coord . }
                 OPTIONAL { ?st pq:P6375 ?street . }
                 ?hq rdfs:label ?hqLabel FILTER(LANG(?hqLabel) = "en") }
    } LIMIT 5`;
  const wait = 1000 - (Date.now() - lastWd);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastWd = Date.now();
  try {
    const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, {
      headers: { accept: 'application/sparql-results+json', 'user-agent': UA },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { results: { bindings: Array<Record<string, { value: string }>> } };
    for (const b of json.results.bindings) {
      const pt = b.coord?.value ?? b.ownCoord?.value; // "Point(lng lat)"
      if (pt) {
        const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(pt);
        if (m) {
          const p = { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
          if (kmBetween(p, city) <= MAX_KM) return { ...p, address: b.street?.value ?? `${b.hqLabel?.value ?? city.name} (Wikidata)`, source: 'wikidata', precision: 'address' };
        }
      }
      if (b.street?.value) {
        const g = await geocodeAddress(`${b.street.value}, ${b.hqLabel?.value ?? city.name}`);
        if (g && g.precise && kmBetween(g, city) <= MAX_KM) return { lat: g.lat, lng: g.lng, address: b.street.value, source: 'wikidata', precision: 'address' };
      }
    }
  } catch { /* network / parse — treat as not found */ }
  return null;
}

// ------------------------------------------------------------------- website

async function fetchText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
    clearTimeout(t);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null;
    const text = await res.text();
    return text.slice(0, 1_500_000);
  } catch {
    return null;
  }
}

function jsonLdAddresses(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    const a = o.address as Record<string, unknown> | Record<string, unknown>[] | string | undefined;
    const addrs = Array.isArray(a) ? a : a ? [a] : [];
    for (const ad of addrs) {
      if (typeof ad === 'string') out.push(ad);
      else if (ad && typeof ad === 'object') {
        const parts = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry']
          .map((k) => { const x = ad[k]; return typeof x === 'string' ? x : (x as Record<string, unknown> | undefined)?.name; })
          .filter(Boolean);
        if (parts.length >= 2) out.push(parts.join(', '));
      }
    }
    Object.values(o).forEach(walk);
  };
  while ((m = re.exec(html))) {
    try { walk(JSON.parse(m[1])); } catch { /* ignore bad JSON */ }
  }
  return out;
}

function textAddressCandidates(html: string, citySlug: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|td|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ');
  const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length >= 8 && l.length <= 160);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    // a line (or line + next) that names the city and contains a number → address-like
    for (const chunk of [lines[i], `${lines[i]}, ${lines[i + 1] ?? ''}`]) {
      if (!/\d/.test(chunk)) continue;
      if (matchCity(chunk)?.slug !== citySlug) continue;
      if (/©|copyright|\bprivacy\b|\bcookies?\b|\bterms\b/i.test(chunk)) continue;
      out.push(chunk.replace(/\s+/g, ' ').trim());
    }
  }
  return [...new Set(out)].slice(0, 6);
}

async function websiteOffice(website: string, citySlug: string, city: { lat: number; lng: number; name: string }): Promise<Found | null> {
  const home = await fetchText(website);
  if (!home) return null;
  const base = new URL(website);
  const pages = [home];
  const links = new Set<string>();
  const lre = /href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = lre.exec(home))) {
    const href = m[1];
    if (/contact|about|locations?|offices?|visit|company/i.test(href) && !/mailto:|tel:/.test(href)) {
      try { links.add(new URL(href, base).toString()); } catch { /* skip */ }
    }
  }
  for (const url of [...links].filter((u) => u.startsWith(base.origin)).slice(0, 3)) {
    const t = await fetchText(url);
    if (t) pages.push(t);
  }
  const candidates: string[] = [];
  for (const p of pages) {
    candidates.push(...jsonLdAddresses(p).filter((a) => matchCity(a)?.slug === citySlug));
    candidates.push(...textAddressCandidates(p, citySlug));
  }
  for (const c of [...new Set(candidates)].slice(0, 4)) {
    const g = await geocodeAddress(c);
    if (g && g.precise && kmBetween(g, city) <= MAX_KM) return { lat: g.lat, lng: g.lng, address: c, source: 'website', precision: 'address' };
  }
  return null;
}

// ---------------------------------------------------------------------- main

async function main() {
  let q = db
    .from('locations')
    .select('id, is_hq, city, city_slug, companies!inner ( slug, name, website )')
    .eq('precision', 'city')
    .or(`lookup_tried_at.is.null,lookup_tried_at.lt.${new Date(Date.now() - RETRY_AFTER_DAYS * 86400000).toISOString()}`)
    .order('is_hq', { ascending: false });
  if (HQ_ONLY) q = q.eq('is_hq', true);
  if (ONLY_COMPANY) q = q.eq('companies.slug', ONLY_COMPANY);
  const { data, error } = await q.limit(LIMIT === Infinity ? 5000 : LIMIT);
  if (error) throw error;

  // locations.city_slug → cities.slug isn't a foreign key, so city centers are fetched separately
  const { data: cityRows } = await db.from('cities').select('slug, name, lat, lng, country');
  const cityBySlug = new Map((cityRows ?? []).map((c) => [c.slug, c]));

  const rows = (data ?? []) as unknown as Row[];
  console.log(`${rows.length} placeholder locations to try (sources: ${[...SOURCES].join(', ')}${HQ_ONLY ? ', HQ only' : ''})${DRY ? ' — dry run' : ''}\n`);

  const tally = { wikidata: 0, website: 0, osm: 0, none: 0 };

  await pMap(rows, 4, async (row) => {
    const company = row.companies;
    const city = cityBySlug.get(row.city_slug);
    if (!city) return;
    let found: Found | null = null;

    if (!found && SOURCES.has('wikidata') && row.is_hq && company.website) found = await wikidataHQ(company.website, city);
    if (!found && SOURCES.has('website') && company.website) found = await websiteOffice(company.website, row.city_slug, city);
    if (!found && SOURCES.has('osm')) {
      const poi = await findCompanyPoi(company.name, city);
      if (poi) found = { lat: poi.lat, lng: poi.lng, address: poi.display, source: 'osm', precision: 'poi' };
    }

    if (found) {
      tally[found.source]++;
      console.log(`  ✓ ${company.name.padEnd(26)} ${row.city.padEnd(16)} ${found.source.padEnd(9)} ${found.address.slice(0, 70)}`);
      if (!DRY) {
        await db.from('locations').update({
          geom: `SRID=4326;POINT(${found.lng} ${found.lat})`,
          precision: found.precision,
          address: found.address.slice(0, 300),
          source: found.source,
          lookup_tried_at: new Date().toISOString(),
        }).eq('id', row.id);
      }
    } else {
      tally.none++;
      if (!DRY) await db.from('locations').update({ lookup_tried_at: new Date().toISOString() }).eq('id', row.id);
    }
  });

  console.log(`\nfound: wikidata ${tally.wikidata}, website ${tally.website}, osm ${tally.osm} · still placeholder ${tally.none}`);
  console.log(`Placeholders are retried after ${RETRY_AFTER_DAYS} days. Add an address to companies.csv for any company you want pin-perfect now.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});