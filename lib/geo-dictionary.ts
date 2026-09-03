import cities from '../data/cities-tier1.json';
import targets from '../data/targets.json';
import { slugify } from './slug';

/**
 * Offline city resolution for Tier-1 metros. Location strings like
 * "San Francisco, CA", "Bengaluru, India", "NYC", "Gurgaon" resolve instantly
 * with no geocoding call. Longer/more specific aliases win ("melbourne, fl"
 * beats "melbourne"; "cambridge, ma" beats "cambridge"), which handles most
 * same-name ambiguity. Anything not matched here falls through to Nominatim.
 */

export interface DictCity {
  slug: string;
  name: string;
  region: string;
  country: string;
  cc: string;
  lat: number;
  lng: number;
  zoom: number;
  aliases: string[];
}

export const DICTIONARY: DictCity[] = cities as DictCity[];
export const ALLOWED_COUNTRIES: Set<string> = new Set((targets as { allowedCountries: string[] }).allowedCountries);

const bySlug = new Map(DICTIONARY.map((c) => [c.slug, c]));

/** All aliases, longest first, each compiled as a whole-phrase regex. */
const ALIASES: Array<{ re: RegExp; city: DictCity }> = DICTIONARY.flatMap((city) =>
  city.aliases.map((a) => ({ alias: a, city })),
)
  .sort((a, b) => b.alias.length - a.alias.length)
  .map(({ alias, city }) => ({
    re: new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i'),
    city,
  }));

const cache = new Map<string, DictCity | null>();

/** Match a raw location string to a dictionary city (null if unknown). */
export function matchCity(text: string): DictCity | null {
  const key = text.toLowerCase().trim();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const t = key.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  let found: DictCity | null = null;
  for (const { re, city } of ALIASES) {
    if (re.test(key) || re.test(t)) {
      found = city;
      break;
    }
  }
  cache.set(key, found);
  return found;
}

export function dictCity(slug: string): DictCity | undefined {
  return bySlug.get(slug);
}

/** City name → canonical slug: dictionary alias (metro-aware) or plain slugify. */
export function canonicalCitySlug(cityName: string): string {
  return matchCity(cityName)?.slug ?? slugify(cityName);
}

export function isAllowedCountry(cc: string | null | undefined): boolean {
  return !!cc && ALLOWED_COUNTRIES.has(cc.toLowerCase());
}
