/**
 * hire.la logo pipeline — target: a real logo for ≥95% of companies.
 *
 * Per company, sources in order (first good image wins):
 *   1. csv       a `logo` URL in companies.csv (e.g. YC directory thumbnails)
 *   2. board     the company's own ATS job-board page (Greenhouse / Lever / Ashby):
 *                header logo or og:image — needs no website at all. Also yields
 *                the company website (home link) when we don't have one.
 *   3. website   Logo.dev (if LOGO_DEV_TOKEN) → Google favicon → DuckDuckGo icon
 *   4. wikidata  logo file (P154) and/or website (P856), matched by exact name
 *   5. guess     {slug}.com/.ai/.io/.co — accepted only if the homepage title
 *                mentions the company; then source 3 on that domain
 *   →  otherwise the map shows a monogram.
 *
 * Websites discovered along the way are saved to companies.website (only when
 * missing), which also feeds the office finder.
 *
 *   npm run logos                 companies without a logo
 *   npm run logos -- --force      re-fetch everything
 *   npm run logos -- --company x  one company (slug)
 *   npm run logos -- --dry        report only
 *
 * Output: public/logos/<slug>.<ext> (commit them), companies.logo_url,
 * coverage summary, and data/logos-missing.json for the leftovers.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../lib/csv';
import { slugify } from '../lib/slug';
import { pMap } from '../lib/pmap';

config({ path: '.env.local' });
config();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOGO_DEV_TOKEN = process.env.LOGO_DEV_TOKEN;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const FORCE = flag('--force');
const DRY = flag('--dry');
const ONLY = opt('--company');
const UA = 'Mozilla/5.0 (compatible; hire-la-logos/2.0; +https://hire.la)';
const ATS_HOSTS = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs|smartrecruiters|workable|bamboohr|jobvite|icims|linkedin|twitter|x\.com|facebook|instagram|youtube|glassdoor|indeed|wellfound|crunchbase|google\.com|apple\.com|cloudfront\.net$|amazonaws\.com$/i;
const BRAND_NOISE = /lever-logo|greenhouse[-_]?logo|ashby[-_]?logo|powered[-_]?by|favicon\.ico$|\/sprite|placeholder|default[-_]?logo|blank\./i;

interface Company { id: string; slug: string; name: string; website: string | null; logo_url: string | null; ats_type: 'greenhouse' | 'lever' | 'ashby'; ats_token: string }
interface Img { buf: Buffer; ext: string }
type Source = 'csv' | 'board' | 'website' | 'wikidata' | 'guess';

// ------------------------------------------------------------------- fetching

async function get(url: string, accept = '*/*', ms = 12000): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept }, redirect: 'follow' });
    clearTimeout(t);
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

async function getHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const res = await get(url, 'text/html');
  if (!res) return null;
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('html') && !type.includes('xml')) return null;
  return { html: (await res.text()).slice(0, 1_500_000), finalUrl: res.url || url };
}

function sniff(buf: Buffer): string | null {
  if (buf.length < 8) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.subarray(0, 4).toString() === 'GIF8') return 'gif';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'ico';
  const head = buf.subarray(0, 300).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return null;
}

async function fetchImage(url: string): Promise<Img | null> {
  const res = await get(url, 'image/*,*/*;q=0.8');
  if (!res) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = sniff(buf);
  if (!ext) return null;
  const min = ext === 'svg' ? 200 : 600; // tiny rasters are default/placeholder icons
  if (buf.length < min) return null;
  return { buf, ext };
}

// ------------------------------------------------------------ html extraction

function absolute(href: string, base: string): string | null {
  try { return new URL(href, base).toString(); } catch { return null; }
}

/** Logo candidates from a page: og/twitter images, then <img> tagged as a logo. */
function logoCandidates(html: string, base: string): string[] {
  const out: string[] = [];
  const meta = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:url)["'][^>]*content=["']([^"']+)["']/gi;
  const meta2 = /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image|og:image:url)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = meta.exec(html))) out.push(m[1]);
  while ((m = meta2.exec(html))) out.push(m[1]);
  const imgs = /<img\b[^>]*>/gi;
  while ((m = imgs.exec(html))) {
    const tag = m[0];
    if (!/logo/i.test(tag)) continue;
    const src = /(?:src|data-src)=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) out.push(src);
  }
  return [...new Set(out)]
    .filter((u) => !u.startsWith('data:') && !BRAND_NOISE.test(u))
    .map((u) => absolute(u, base))
    .filter((u): u is string => !!u);
}

/** The company's own site, if the board page links to it (logo link, "home", or first external link). */
function websiteFromBoard(html: string, base: string): string | null {
  const baseHost = (() => { try { return new URL(base).hostname; } catch { return ''; } })();
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)];
  const external = (href: string) => {
    const u = absolute(href, base);
    if (!u || !/^https?:/i.test(u)) return null;
    const h = new URL(u).hostname;
    if (!h || h === baseHost || ATS_HOSTS.test(h) || /mailto:|tel:/.test(u)) return null;
    return `https://${h.replace(/^www\./, '')}`;
  };
  // 1. anchor wrapping a logo image, or class/rel/aria hinting at home
  for (const a of anchors) {
    if (/logo|rel=["']home|aria-label=["'][^"']*home|class=["'][^"']*(home|brand|logo)/i.test(a[0])) {
      const w = external(a[1]);
      if (w) return w;
    }
  }
  // 2. link text like "company website" / "visit our website"
  for (const a of anchors) {
    if (/website|homepage|visit us|our site|back to/i.test(a[2].replace(/<[^>]+>/g, ' '))) {
      const w = external(a[1]);
      if (w) return w;
    }
  }
  return null;
}

// -------------------------------------------------------------------- sources

async function fromBoardPage(c: Company): Promise<{ img: Img | null; website: string | null }> {
  const url =
    c.ats_type === 'greenhouse' ? `https://boards.greenhouse.io/${c.ats_token}`
    : c.ats_type === 'lever' ? `https://jobs.lever.co/${c.ats_token}`
    : `https://jobs.ashbyhq.com/${c.ats_token}`;
  const page = await getHtml(url);
  if (!page) return { img: null, website: null };
  const website = websiteFromBoard(page.html, page.finalUrl);
  for (const cand of logoCandidates(page.html, page.finalUrl).slice(0, 4)) {
    const img = await fetchImage(cand);
    if (img) return { img, website };
  }
  return { img: null, website };
}

async function fromWebsite(website: string): Promise<Img | null> {
  let domain: string;
  try { domain = new URL(website).hostname.replace(/^www\./, ''); } catch { return null; }
  const urls = [
    ...(LOGO_DEV_TOKEN ? [`https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&size=128&format=png`] : []),
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ];
  for (const u of urls) {
    const img = await fetchImage(u);
    if (img) return img;
  }
  // last resort on the site itself: og:image / logo <img> from the homepage
  const page = await getHtml(website);
  if (page) {
    for (const cand of logoCandidates(page.html, page.finalUrl).slice(0, 3)) {
      const img = await fetchImage(cand);
      if (img) return img;
    }
  }
  return null;
}

let lastWd = 0;
async function wd(url: string): Promise<unknown | null> {
  const wait = 1000 - (Date.now() - lastWd);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastWd = Date.now();
  const res = await get(url, 'application/json');
  return res ? res.json().catch(() => null) : null;
}

async function fromWikidata(c: Company): Promise<{ img: Img | null; website: string | null }> {
  const search = (await wd(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(c.name)}&language=en&type=item&limit=5&format=json`,
  )) as { search?: Array<{ id: string; label?: string }> } | null;
  const norm = (s: string) => s.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|labs?)\b|[^a-z0-9]/g, '');
  const hit = search?.search?.find((s) => s.label && norm(s.label) === norm(c.name));
  if (!hit) return { img: null, website: null };
  const ent = (await wd(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hit.id}&props=claims&format=json`,
  )) as { entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> }> } | null;
  const claims = ent?.entities?.[hit.id]?.claims ?? {};
  const website = (claims.P856?.[0]?.mainsnak?.datavalue?.value as string | undefined) ?? null;
  const logoFile = claims.P154?.[0]?.mainsnak?.datavalue?.value as string | undefined;
  let img: Img | null = null;
  if (logoFile) {
    img = await fetchImage(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(logoFile)}?width=256`);
  }
  return { img, website: website ? website.replace(/\/$/, '') : null };
}

async function guessWebsite(c: Company): Promise<string | null> {
  const base = slugify(c.name).replace(/-/g, '');
  const first = c.name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '');
  const stems = [...new Set([base, first].filter((s) => s.length >= 3))];
  for (const stem of stems) {
    for (const tld of ['com', 'ai', 'io', 'co']) {
      const url = `https://${stem}.${tld}`;
      const page = await getHtml(url);
      if (!page) continue;
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.html)?.[1]?.toLowerCase() ?? '';
      if (title.includes(first) || title.includes(stem)) return `https://${new URL(page.finalUrl).hostname.replace(/^www\./, '')}`;
    }
  }
  return null;
}

// ----------------------------------------------------------------------- save

function saveLogo(slug: string, img: Img): string {
  for (const f of readdirSync('public/logos')) {
    if (f.startsWith(`${slug}.`) && f !== `${slug}.${img.ext}`) unlinkSync(`public/logos/${f}`);
  }
  writeFileSync(`public/logos/${slug}.${img.ext}`, img.buf);
  return `/logos/${slug}.${img.ext}`;
}

// ----------------------------------------------------------------------- main

async function main() {
  mkdirSync('public/logos', { recursive: true });
  const csvLogo = new Map<string, string>();
  if (existsSync('companies.csv')) {
    for (const r of parseCsv(readFileSync('companies.csv', 'utf8'))) if (r.logo) csvLogo.set(slugify(r.name), r.logo);
  }

  let q = db.from('companies').select('id, slug, name, website, logo_url, ats_type, ats_token').order('name');
  if (ONLY) q = q.eq('slug', ONLY);
  const { data, error } = await q.limit(10000);
  if (error) throw error;
  const companies = (data ?? []) as Company[];
  const todo = FORCE ? companies : companies.filter((c) => !c.logo_url);
  console.log(`${companies.length} companies, ${companies.length - todo.length} already have logos, ${todo.length} to process${DRY ? ' (dry run)' : ''}\n`);

  const tally: Record<Source | 'none', number> = { csv: 0, board: 0, website: 0, wikidata: 0, guess: 0, none: 0 };
  const missing: string[] = [];
  let websitesFound = 0;

  await pMap(todo, 5, async (c) => {
    let img: Img | null = null;
    let source: Source | null = null;
    let website = c.website;

    const fromCsv = csvLogo.get(c.slug);
    if (fromCsv) { img = await fetchImage(fromCsv); if (img) source = 'csv'; }

    if (!img) {
      const b = await fromBoardPage(c);
      if (!website && b.website) website = b.website;
      if (b.img) { img = b.img; source = 'board'; }
    }

    if (!img && website) { img = await fromWebsite(website); if (img) source = 'website'; }

    if (!img) {
      const w = await fromWikidata(c);
      if (!website && w.website) website = w.website;
      if (w.img) { img = w.img; source = 'wikidata'; }
      else if (w.website && !c.website) { img = await fromWebsite(w.website); if (img) source = 'website'; }
    }

    if (!img && !website) {
      const g = await guessWebsite(c);
      if (g) { website = g; img = await fromWebsite(g); if (img) source = 'guess'; }
    }

    if (img && source) {
      tally[source]++;
      const url = DRY ? `(dry) ${source}` : saveLogo(c.slug, img);
      console.log(`  ✓ ${c.name.padEnd(28)} ${source.padEnd(9)} ${(img.buf.length / 1024).toFixed(1).padStart(6)} KB ${img.ext}`);
      if (!DRY) {
        const patch: Record<string, string> = { logo_url: url };
        if (website && !c.website) { patch.website = website; websitesFound++; }
        await db.from('companies').update(patch).eq('id', c.id);
      }
    } else {
      tally.none++;
      missing.push(c.name);
      console.log(`  ✗ ${c.name.padEnd(28)} no logo found${website ? ` (site: ${website})` : ''}`);
      if (!DRY && website && !c.website) { await db.from('companies').update({ website }).eq('id', c.id); websitesFound++; }
    }
  });

  const withLogo = companies.length - missing.length;
  const coverage = companies.length ? (withLogo / companies.length) * 100 : 0;
  console.log('\n==================== LOGO COVERAGE ====================');
  console.log(`csv ${tally.csv} · board ${tally.board} · website ${tally.website} · wikidata ${tally.wikidata} · guess ${tally.guess} · none ${tally.none}`);
  console.log(`websites discovered: ${websitesFound}`);
  console.log(`companies with a logo: ${withLogo}/${companies.length} (${coverage.toFixed(1)}%)`);
  if (!DRY) {
    mkdirSync('data', { recursive: true });
    writeFileSync('data/logos-missing.json', JSON.stringify(missing.sort(), null, 2));
    console.log(`still missing: ${missing.length} → data/logos-missing.json (add a website or logo URL in companies.csv and re-run)`);
    console.log('Commit public/logos/ so Vercel serves the files.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});