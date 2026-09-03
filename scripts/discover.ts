/**
 * hire.la company discovery
 *
 * Finds companies AND their job-board tokens, then appends them to
 * companies.csv (skipping ones already present). No addresses needed — the
 * worker discovers offices from job listings; a city-level HQ is recorded
 * when the source provides one.
 *
 *   npm run discover -- --yc                 YC companies (Active/Public) matched to known boards
 *   npm run discover -- --yc --hiring        …only those YC flags as hiring
 *   npm run discover -- --yc --probe         …also test likely tokens against the ATS APIs
 *   npm run discover -- --harvest --limit 200   top boards from data/boards.json (no websites)
 *   npm run discover -- --harvest --all         every harvested board (~1,800)
 *   npm run discover -- --list my-list.csv [--probe]   any list with columns: name,website
 *   npm run discover -- --url https://…/portfolio [--probe]   scrape company links off a portfolio page
 *   add --dry to preview without writing
 *
 * Accelerator / investor coverage: YC is the only one with an open dataset.
 * Techstars, 500 Global, Antler, a16z, Sequoia etc. publish portfolio web
 * pages — use --url on them (works when the page is server-rendered HTML with
 * one link per company; JS-only pages return nothing → copy to CSV and use
 * --list instead).
 *
 * Token sources, in order of trust:
 *   1. data/boards.json — real application URLs harvested from public job trackers
 *   2. --probe — tries slug/domain-derived tokens against the live APIs.
 *      Greenhouse exposes the board's company name, so those are name-verified;
 *      Lever/Ashby are accepted only when the token equals the company's slug
 *      or domain root (they don't expose a name to check).
 *
 * Then run: npm run seed (validates every token) → npm run logos → npm run worker
 *
 * Harvest refresh (how data/boards.json was built): clone
 * SimplifyJobs/New-Grad-Positions and SimplifyJobs/Summer2026-Internships,
 * read .github/scripts/listings.json, extract boards.greenhouse.io /
 * job-boards.greenhouse.io / jobs.lever.co / jobs.ashbyhq.com URLs.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseCsv } from '../lib/csv';
import { slugify } from '../lib/slug';

type Ats = 'greenhouse' | 'lever' | 'ashby';
interface Board { ats: Ats; token: string; name: string; listings: number }
interface Candidate { name: string; website: string; location?: string; logo?: string; source: string; batch?: string }
interface Row { [k: string]: string }

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag('--dry');
const PROBE = flag('--probe');
const LIMIT = Number(opt('--limit') ?? '0') || Infinity;

const CSV_PATH = 'companies.csv';
const COLUMNS = ['name', 'website', 'ats_type', 'ats_token', 'address', 'city', 'is_hq', 'verified', 'logo', 'source'];

// ----------------------------------------------------------------- helpers

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|labs?|technologies|technology|ai|io|hq)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

const domainRoot = (website: string) => {
  try {
    const host = new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '');
    return host.split('.')[0].toLowerCase();
  } catch {
    return '';
  }
};

const GENERIC = new Set(['clear', 'hive', 'reach', 'radar', 'tempo', 'flip', 'close', 'weave', 'wave', 'level', 'bolt', 'spark', 'nova', 'atlas', 'origin', 'vector', 'scale', 'shift', 'loop', 'pulse', 'signal', 'echo', 'zero', 'one', 'first', 'plus', 'next', 'core', 'base', 'lab', 'labs', 'ai', 'app', 'apps', 'data', 'cloud', 'tech']);

const boards: Board[] = JSON.parse(readFileSync('data/boards.json', 'utf8'));
const boardsByKey = new Map<string, Board[]>();
for (const b of boards) {
  for (const k of new Set([norm(b.name), norm(b.token), b.token.toLowerCase()])) {
    if (!k) continue;
    const arr = boardsByKey.get(k) ?? [];
    arr.push(b);
    boardsByKey.set(k, arr);
  }
}

/** Match a company to a harvested board. Strong = token equals domain/slug; moderate = distinctive name match. */
function matchBoard(c: Candidate): Board | null {
  const dom = domainRoot(c.website);
  const slug = slugify(c.name).replace(/-/g, '');
  const strongKeys = [dom, slug].filter(Boolean);
  for (const k of strongKeys) {
    const hit = boardsByKey.get(k)?.find((b) => b.token.toLowerCase().replace(/[^a-z0-9]/g, '') === k);
    if (hit) return hit;
  }
  const nameKey = norm(c.name);
  if (nameKey.length >= 5 && !GENERIC.has(nameKey)) {
    const hit = boardsByKey.get(nameKey)?.find((b) => norm(b.name) === nameKey);
    if (hit) return hit;
  }
  return null;
}

// ------------------------------------------------------------------ probing

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastProbe = 0;
async function probeFetch(url: string): Promise<Response | null> {
  const wait = 300 - (Date.now() - lastProbe);
  if (wait > 0) await sleep(wait);
  lastProbe = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': 'hire-la-discover/1.0' } });
    clearTimeout(t);
    return res;
  } catch {
    return null;
  }
}

async function probeTokens(c: Candidate): Promise<Board | null> {
  const dom = domainRoot(c.website);
  const slug = slugify(c.name);
  const cands = [...new Set([slug, slug.replace(/-/g, ''), dom, `${dom}-com`].filter((t) => t && t.length >= 2))];
  const want = norm(c.name);

  for (const t of cands) {
    // Greenhouse: board metadata carries the company name → verifiable
    const gh = await probeFetch(`https://boards-api.greenhouse.io/v1/boards/${t}`);
    if (gh?.ok) {
      const meta = (await gh.json().catch(() => null)) as { name?: string } | null;
      const got = norm(meta?.name ?? '');
      if (got && (got.includes(want) || want.includes(got))) return { ats: 'greenhouse', token: t, name: c.name, listings: 0 };
    }
    // Lever / Ashby: no name to verify → accept only exact slug/domain tokens
    if (t === slug || t === dom || t === slug.replace(/-/g, '')) {
      const lv = await probeFetch(`https://api.lever.co/v0/postings/${t}?mode=json&limit=1`);
      if (lv?.ok) {
        const arr = await lv.json().catch(() => null);
        if (Array.isArray(arr)) return { ats: 'lever', token: t, name: c.name, listings: 0 };
      }
      const ab = await probeFetch(`https://api.ashbyhq.com/posting-api/job-board/${t}`);
      if (ab?.ok) {
        const j = (await ab.json().catch(() => null)) as { jobs?: unknown[] } | null;
        if (Array.isArray(j?.jobs)) return { ats: 'ashby', token: t, name: c.name, listings: 0 };
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ sources

async function ycCandidates(): Promise<Candidate[]> {
  const base = 'https://raw.githubusercontent.com/yc-oss/api/main/companies';
  const all = (await (await fetch(`${base}/all.json`)).json()) as Array<Record<string, unknown>>;
  let hiringIds: Set<number> | null = null;
  if (flag('--hiring')) {
    const hiring = (await (await fetch(`${base}/hiring.json`)).json()) as Array<{ id: number }>;
    hiringIds = new Set(hiring.map((h) => h.id));
  }
  return all
    .filter((c) => ['Active', 'Public'].includes(String(c.status)))
    .filter((c) => !hiringIds || hiringIds.has(Number(c.id)))
    .filter((c) => c.website)
    .map((c) => {
      const loc = String(c.all_locations ?? '').split(';')[0].trim();
      return {
        name: String(c.name),
        website: String(c.website),
        location: /remote/i.test(loc) ? undefined : loc || undefined,
        logo: c.small_logo_thumb_url ? String(c.small_logo_thumb_url) : undefined,
        source: 'yc',
        batch: c.batch ? String(c.batch) : undefined,
      };
    });
}

function harvestCandidates(existingTokens: Set<string>): Row[] {
  return boards
    .filter((b) => !existingTokens.has(`${b.ats}:${b.token}`))
    .slice(0, flag('--all') ? undefined : LIMIT === Infinity ? 200 : LIMIT)
    .map((b) => ({ name: b.name, website: '', ats_type: b.ats, ats_token: b.token, address: '', city: '', is_hq: 'false', verified: 'no', logo: '', source: 'harvest' }));
}

/** Pull company links off a portfolio page: external anchors, one per domain. */
async function urlCandidates(pageUrl: string): Promise<Candidate[]> {
  const res = await fetch(pageUrl, { headers: { 'user-agent': 'hire-la-discover/1.0' } });
  if (!res.ok) throw new Error(`fetch ${pageUrl}: HTTP ${res.status}`);
  const html = await res.text();
  const pageHost = new URL(pageUrl).hostname.replace(/^www\./, '');
  const SKIP = /(linkedin|twitter|x\.com|facebook|instagram|youtube|medium|crunchbase|angel\.co|wellfound|github|apple\.com|google\.com|notion\.site|substack|tiktok|spotify\.com\/show|mailto:|javascript:)/i;
  const seen = new Map<string, Candidate>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    if (!/^https?:\/\//i.test(href) || SKIP.test(href)) continue;
    let host: string;
    try { host = new URL(href).hostname.replace(/^www\./, ''); } catch { continue; }
    if (!host || host === pageHost || host.endsWith(`.${pageHost}`)) continue;
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const name = text && text.length <= 40 && !/^https?:/i.test(text) ? text : host.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (!seen.has(host)) seen.set(host, { name, website: `https://${host}`, source: `url:${pageHost}` });
  }
  return [...seen.values()];
}

function listCandidates(path: string): Candidate[] {
  return parseCsv(readFileSync(path, 'utf8'))
    .filter((r) => r.name)
    .map((r) => ({ name: r.name, website: r.website ?? '', location: r.location || r.city || undefined, source: `list:${path}` }));
}

// --------------------------------------------------------------------- CSV

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toRow(c: Candidate, b: Board): Row {
  const city = c.location ? c.location.split(',')[0].trim() : '';
  return {
    name: c.name,
    website: c.website,
    ats_type: b.ats,
    ats_token: b.token,
    address: c.location ?? '',
    city,
    is_hq: c.location ? 'true' : 'false',
    verified: 'no',
    logo: c.logo ?? '',
    source: c.batch ? `${c.source} ${c.batch}` : c.source,
  };
}

// -------------------------------------------------------------------- main

async function main() {
  const existing: Row[] = existsSync(CSV_PATH) ? parseCsv(readFileSync(CSV_PATH, 'utf8')) : [];
  const existingTokens = new Set(existing.map((r) => `${r.ats_type}:${r.ats_token}`));
  const existingNames = new Set(existing.map((r) => norm(r.name)));

  let candidates: Candidate[] = [];
  let newRows: Row[] = [];

  if (flag('--yc')) candidates.push(...(await ycCandidates()));
  const listPath = opt('--list');
  if (listPath) candidates.push(...listCandidates(listPath));
  const pageUrl = opt('--url');
  if (pageUrl) {
    const found = await urlCandidates(pageUrl);
    console.log(`${found.length} company links found on ${pageUrl}`);
    candidates.push(...found);
  }
  if (flag('--harvest')) newRows.push(...harvestCandidates(existingTokens));

  candidates = candidates.filter((c) => !existingNames.has(norm(c.name)));
  console.log(`${candidates.length} candidate companies, ${boards.length} known boards${PROBE ? ', probing enabled' : ''}\n`);

  let matched = 0, probed = 0, unmatched = 0;
  for (const c of candidates) {
    if (newRows.length >= LIMIT) break;
    let b = matchBoard(c);
    if (!b && PROBE) {
      b = await probeTokens(c);
      if (b) probed++;
    } else if (b) matched++;

    if (!b) { unmatched++; continue; }
    if (existingTokens.has(`${b.ats}:${b.token}`)) continue;
    existingTokens.add(`${b.ats}:${b.token}`);
    newRows.push(toRow(c, b));
    console.log(`  + ${c.name.padEnd(26)} ${b.ats.padEnd(10)} ${b.token.padEnd(28)} ${c.location ?? ''}`);
  }

  console.log(`\nmatched from harvest: ${matched}, found by probing: ${probed}, no board found: ${unmatched}`);
  console.log(`new rows: ${newRows.length}`);

  if (DRY || newRows.length === 0) {
    if (DRY) console.log('(dry run — nothing written)');
    return;
  }

  const allRows = [...existing, ...newRows];
  const out = [COLUMNS.join(','), ...allRows.map((r) => COLUMNS.map((c) => csvEscape(r[c] ?? '')).join(','))].join('\n') + '\n';
  writeFileSync(CSV_PATH, out);
  console.log(`companies.csv now has ${allRows.length} companies. Next: npm run seed → npm run logos → npm run worker`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
