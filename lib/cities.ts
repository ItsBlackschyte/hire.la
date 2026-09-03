/**
 * City model + a static fallback registry.
 *
 * The live list comes from the database (/api/cities → cities_with_counts),
 * discovered automatically by the worker from job locations. The static list
 * below is only a fallback so the app renders sensibly before that request
 * completes (and offline in tests). `slug` matches locations.city_slug.
 * `center` is [lng, lat] (MapLibre order).
 */

export interface City {
  country: string;
  region?: string;
  city: string;
  slug: string;
  center: [number, number];
  zoom: number;
  jobs?: number;
}

export const FALLBACK_CITIES: City[] = [
  { country: 'United States', region: 'California', city: 'Los Angeles', slug: 'los-angeles', center: [-118.32, 34.0], zoom: 9.5 },
  { country: 'United States', region: 'California', city: 'San Francisco', slug: 'san-francisco', center: [-122.42, 37.77], zoom: 11 },
  { country: 'India', region: 'Maharashtra', city: 'Pune', slug: 'pune', center: [73.8567, 18.5204], zoom: 11 },
  { country: 'India', region: 'Karnataka', city: 'Bengaluru', slug: 'bengaluru', center: [77.5946, 12.9716], zoom: 11 },
];

export const DEFAULT_CITY = FALLBACK_CITIES[0];

export function countriesOf(list: City[]): string[] {
  return [...new Set(list.map((c) => c.country))];
}

export function citiesInCountry(list: City[], country: string): City[] {
  return list.filter((c) => c.country === country);
}

export function cityBySlug(list: City[], slug: string | null | undefined): City {
  return list.find((c) => c.slug === slug) ?? FALLBACK_CITIES.find((c) => c.slug === slug) ?? DEFAULT_CITY;
}
