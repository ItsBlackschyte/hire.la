import type { SupabaseClient } from '@supabase/supabase-js';
import { slugify } from '../lib/slug';
import { DICTIONARY, dictCity, isAllowedCountry, matchCity, type DictCity } from '../lib/geo-dictionary';
import { findCompanyPoi, geocodeCity } from './geocode';

/**
 * Resolves a job's raw location string to a `locations` row for its company.
 *
 *   1. Dictionary (offline, instant): ~160 Tier-1 metros with aliases —
 *      "Bengaluru, India", "NYC", "Gurgaon", "Hawthorne, CA" never hit a geocoder.
 *   2. Cache (location_aliases): every other distinct string is geocoded once.
 *      Strings that land outside the allowed countries are remembered as
 *      EXCLUDED and their jobs skipped (not stored).
 *   3. Nominatim: only for strings the dictionary doesn't know, within a
 *      per-run budget; the rest defer to the next run.
 *
 * Office rows: existing (company, city) rows are reused first — so a manual
 * address from companies.csv always wins — otherwise a city-center
 * placeholder is created (or the OSM office, when POI_LOOKUP=1).
 */

export interface CityRow {
  slug: string; name: string; region: string | null; country: string; country_code: string | null;
  lng: number; lat: number; zoom: number;
}
export interface LocationRow {
  id: string; company_id: string; city: string; city_slug: string; is_hq: boolean;
  precision: 'address' | 'poi' | 'city';
}
export interface ResolveResult {
  locationId: string | null;
  citySlug: string | null;
  remote: boolean;
  fallback: boolean;        // landed on HQ (couldn't place)
  excluded: boolean;        // outside allowed countries → skip the job
  deferred: boolean;        // budget exhausted → retried next run
  createdCity: boolean;
  createdLocation: boolean;
  precision: LocationRow['precision'] | null;
}

const RETRY_UNRESOLVED_AFTER_MS = 30 * 24 * 3600 * 1000;
const GEOCODE_BUDGET = Number(process.env.GEOCODE_BUDGET ?? 800);
const POI_LOOKUP = process.env.POI_LOOKUP === '1';

export class LocationResolver {
  geocodeCalls = 0;
  deferred = 0;
  private aliases = new Map<string, { citySlug: string | null; excluded: boolean; triedAt: number }>();
  private cities = new Map<string, CityRow>();
  private locationsByCompany = new Map<string, Map<string, LocationRow>>();
  private pendingCity = new Map<string, Promise<string | null>>();

  constructor(private db: SupabaseClient) {}

  async load() {
    const [{ data: aliases }, { data: cities }, { data: locations }] = await Promise.all([
      this.db.from('location_aliases').select('raw, city_slug, excluded, tried_at'),
      this.db.from('cities').select('slug, name, region, country, country_code, lng, lat, zoom'),
      this.db.from('locations').select('id, company_id, city, city_slug, is_hq, precision'),
    ]);
    for (const a of aliases ?? []) {
      this.aliases.set(a.raw, { citySlug: a.city_slug, excluded: !!a.excluded, triedAt: new Date(a.tried_at).getTime() });
    }
    for (const c of cities ?? []) this.cities.set(c.slug, c as CityRow);
    for (const l of locations ?? []) {
      const m = this.locationsByCompany.get(l.company_id) ?? new Map<string, LocationRow>();
      m.set(l.city_slug, l as LocationRow);
      this.locationsByCompany.set(l.company_id, m);
    }
    // Make every dictionary city known to the database (listed once it has jobs).
    const missing = DICTIONARY.filter((d) => !this.cities.has(d.slug)).map((d) => ({
      slug: d.slug, name: d.name, region: d.region, country: d.country, country_code: d.cc,
      lng: d.lng, lat: d.lat, zoom: d.zoom, source: 'auto',
    }));
    if (missing.length) {
      await this.db.from('cities').upsert(missing, { onConflict: 'slug', ignoreDuplicates: true });
      for (const m of missing) this.cities.set(m.slug, m as CityRow);
    }
  }

  private hqOf(companyId: string): LocationRow | null {
    const m = this.locationsByCompany.get(companyId);
    if (!m) return null;
    return [...m.values()].find((l) => l.is_hq) ?? [...m.values()][0] ?? null;
  }

  async resolve(company: { id: string; slug: string; name: string }, rawText: string): Promise<ResolveResult> {
    const remote = /\bremote\b/i.test(rawText);
    const text = cleanLocationText(rawText);
    const hq = this.hqOf(company.id);
    const base: ResolveResult = {
      locationId: hq?.id ?? null, citySlug: hq?.city_slug ?? null, remote,
      fallback: true, excluded: false, deferred: false, createdCity: false, createdLocation: false,
      precision: hq?.precision ?? null,
    };
    if (!text) return base;

    // 1. dictionary
    let citySlug: string | null | undefined = matchCity(text)?.slug;

    // 2. cache / 3. geocoder
    if (!citySlug) {
      const key = text.toLowerCase();
      const cached = this.aliases.get(key);
      if (cached && (cached.citySlug || cached.excluded || Date.now() - cached.triedAt < RETRY_UNRESOLVED_AFTER_MS)) {
        if (cached.excluded) return { ...base, excluded: true, locationId: null, fallback: false };
        citySlug = cached.citySlug;
      } else {
        if (this.geocodeCalls >= GEOCODE_BUDGET) {
          this.deferred++;
          return { ...base, deferred: true };
        }
        this.geocodeCalls++;
        const result = await this.discoverCity(text);
        if (result === 'excluded') {
          await this.saveAlias(key, null, true);
          return { ...base, excluded: true, locationId: null, fallback: false };
        }
        citySlug = result;
        if (citySlug && !this.cities.has(citySlug)) base.createdCity = true;
        await this.saveAlias(key, citySlug, false);
      }
    }

    if (!citySlug) return base;

    // office row for (company, city): reuse first
    const existing = this.locationsByCompany.get(company.id)?.get(citySlug);
    if (existing) return { ...base, locationId: existing.id, citySlug, fallback: false, precision: existing.precision };

    const city = this.cities.get(citySlug) ?? fromDict(dictCity(citySlug));
    if (!city) return base;

    let poi: { lat: number; lng: number; display: string } | null = null;
    if (POI_LOOKUP && this.geocodeCalls < GEOCODE_BUDGET) {
      this.geocodeCalls++;
      poi = await findCompanyPoi(company.name, city);
    }
    const point = poi ?? jitter(city, company.slug);
    const precision: LocationRow['precision'] = poi ? 'poi' : 'city';
    const isFirstOffice = !this.locationsByCompany.get(company.id)?.size;

    const { data: inserted, error } = await this.db
      .from('locations')
      .insert({
        company_id: company.id, label: city.name, address: poi?.display ?? null, city: city.name, city_slug: citySlug,
        geom: `SRID=4326;POINT(${point.lng} ${point.lat})`, is_hq: isFirstOffice, precision,
        source: poi ? 'osm' : 'placeholder',
      })
      .select('id, company_id, city, city_slug, is_hq, precision')
      .single();
    if (error || !inserted) return base;

    const row = inserted as LocationRow;
    const m = this.locationsByCompany.get(company.id) ?? new Map<string, LocationRow>();
    m.set(citySlug, row);
    this.locationsByCompany.set(company.id, m);
    return { ...base, locationId: row.id, citySlug, fallback: false, createdLocation: true, precision };
  }

  private async saveAlias(key: string, citySlug: string | null, excluded: boolean) {
    this.aliases.set(key, { citySlug, excluded, triedAt: Date.now() });
    await this.db.from('location_aliases').upsert(
      { raw: key, city_slug: citySlug, excluded, tried_at: new Date().toISOString() },
      { onConflict: 'raw' },
    );
  }

  /** Geocode → city slug, 'excluded' (disallowed country), or null (unresolvable). Concurrency-safe. */
  private async discoverCity(text: string): Promise<string | null | 'excluded'> {
    const geo = await geocodeCity(text);
    if (!geo) return null;
    if (!isAllowedCountry(geo.countryCode)) return 'excluded';

    // Geocoder may return a name the dictionary knows (metro grouping).
    const dict = matchCity(geo.name) ?? matchCity(`${geo.name}, ${geo.country}`);
    if (dict) return dict.slug;

    let slug = slugify(geo.name);
    const clash = this.cities.get(slug);
    if (clash && geo.countryCode && clash.country_code && clash.country_code !== geo.countryCode) {
      slug = `${slugify(geo.name)}-${geo.countryCode}`;
    }
    if (this.cities.has(slug)) return slug;

    const pending = this.pendingCity.get(slug);
    if (pending) return pending;
    const task = (async () => {
      const row: CityRow = {
        slug, name: geo.name, region: geo.region, country: geo.country, country_code: geo.countryCode,
        lng: geo.lng, lat: geo.lat, zoom: 11,
      };
      const { error } = await this.db.from('cities').upsert({ ...row, source: 'auto' }, { onConflict: 'slug', ignoreDuplicates: true });
      if (error) return null;
      this.cities.set(slug, row);
      return slug;
    })();
    this.pendingCity.set(slug, task);
    return task;
  }
}

function fromDict(d: DictCity | undefined): CityRow | null {
  return d ? { slug: d.slug, name: d.name, region: d.region, country: d.country, country_code: d.cc, lng: d.lng, lat: d.lat, zoom: d.zoom } : null;
}

/** "Hawthorne, CA; Redmond, WA" → "Hawthorne, CA" · "Remote - US" → "" · "Pune (Hybrid)" → "Pune" */
export function cleanLocationText(raw: string): string {
  let t = raw.split(/[;|/]|\s-\s(?=[A-Z])/)[0] ?? raw;
  t = t.replace(/\((?:[^)]*)\)/g, ' ');
  t = t.replace(/\b(remote|hybrid|on[- ]?site|flexible|anywhere|multiple locations|various)\b/gi, ' ');
  t = t.replace(/\s+/g, ' ').replace(/^[\s,–-]+|[\s,–-]+$/g, '').trim();
  return t.length < 2 ? '' : t;
}

/** Deterministic ~200–800 m offset so several city-center pins don't stack. */
function jitter(city: { lat: number; lng: number }, seed: string): { lat: number; lng: number } {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const angle = ((h % 360) * Math.PI) / 180;
  const meters = 200 + (h % 600);
  return {
    lat: city.lat + (meters * Math.cos(angle)) / 111_320,
    lng: city.lng + (meters * Math.sin(angle)) / (111_320 * Math.cos((city.lat * Math.PI) / 180)),
  };
}
