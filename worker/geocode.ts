/**
 * Nominatim (OpenStreetMap) geocoding for the worker — throttled to the
 * 1 request/second policy and used only for strings never seen before
 * (see location_aliases). No key, no cost.
 */

const UA = 'hire-la-worker/1.0 (job map; contact hello@hire.la)';
let last = 0;

async function throttle() {
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  class?: string;
  type?: string;
  address?: Record<string, string>;
}

async function query(params: Record<string, string>): Promise<NominatimResult[]> {
  await throttle();
  const q = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', 'accept-language': 'en', ...params });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { 'user-agent': UA } });
  if (!res.ok) return [];
  return (await res.json()) as NominatimResult[];
}

export interface GeocodedCity {
  name: string;
  region: string | null;
  country: string;
  countryCode: string | null;
  lat: number;
  lng: number;
}

/** Resolve a free-text location ("Pune, Maharashtra, India") to a city. */
export async function geocodeCity(text: string): Promise<GeocodedCity | null> {
  const results = await query({ q: text, limit: '1' });
  const r = results[0];
  if (!r?.address) return null;
  const a = r.address;
  const name = a.city ?? a.town ?? a.village ?? a.municipality ?? a.city_district ?? a.county;
  if (!name || !a.country) return null; // country-only strings ("United States") aren't a city
  return {
    name,
    region: a.state ?? a.region ?? null,
    country: a.country,
    countryCode: a.country_code ?? null,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  };
}

// Office-like OSM features only. No amenity/shop: "Julius" must not match "Julius' Castle" (a restaurant).
const POI_CLASSES = new Set(['office', 'building', 'industrial', 'commercial', 'man_made']);
const norm = (s: string) => s.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|labs?|technologies|technology)\b/g, '').replace(/[^a-z0-9]/g, '');

/** Try to find the company's actual office in OSM near a city (full-name match, office-type feature). */
export async function findCompanyPoi(
  company: string,
  city: GeocodedCity | { name: string; lat: number; lng: number },
): Promise<{ lat: number; lng: number; display: string } | null> {
  const results = await query({ q: `${company}, ${city.name}`, limit: '5' });
  const want = norm(company);
  if (want.length < 3) return null;
  for (const r of results) {
    const placeName = norm(r.display_name.split(',')[0]); // the feature's own name, not the whole address
    if (placeName !== want && !placeName.startsWith(want)) continue;
    if (!r.class || !POI_CLASSES.has(r.class)) continue;
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    const km = Math.hypot((lat - city.lat) * 111, (lng - city.lng) * 111 * Math.cos((city.lat * Math.PI) / 180));
    if (km > 60) continue;
    return { lat, lng, display: r.display_name };
  }
  return null;
}

const AREA_TYPES = new Set(['city', 'town', 'village', 'municipality', 'administrative', 'postcode', 'state', 'county', 'suburb', 'neighbourhood', 'quarter', 'country', 'region', 'district', 'boundary']);

/**
 * Geocode a street address. `precise` is true only when Nominatim matched a
 * building/road/office-level feature — a city or postcode match is not an
 * office location and must not be recorded as one.
 */
export async function geocodeAddress(text: string): Promise<{ lat: number; lng: number; display: string; precise: boolean } | null> {
  const results = await query({ q: text, limit: '1' });
  const r = results[0] as (NominatimResult & { addresstype?: string }) | undefined;
  if (!r) return null;
  const t = (r.addresstype ?? r.type ?? '').toLowerCase();
  return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), display: r.display_name, precise: !AREA_TYPES.has(t) };
}
