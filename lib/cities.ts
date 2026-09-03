/**
 * The city registry. Adding a city to the product = one entry here plus
 * seeded companies for it in companies.csv (with a matching METRO mapping
 * in scripts/seed.ts if the metro spans several municipalities).
 *
 * `slug` must match locations.city_slug in the database.
 * `center` is [lng, lat] (MapLibre order). `zoom` is the arrival zoom.
 */

export interface City {
  country: string;
  city: string;
  slug: string;
  center: [number, number];
  zoom: number;
}

export const CITIES: City[] = [
  { country: 'United States', city: 'Los Angeles', slug: 'los-angeles', center: [-118.32, 34.0], zoom: 9.5 },
  { country: 'United States', city: 'San Francisco', slug: 'san-francisco', center: [-122.42, 37.77], zoom: 11 },
  { country: 'India', city: 'Pune', slug: 'pune', center: [73.8567, 18.5204], zoom: 11 },
  { country: 'India', city: 'Bengaluru', slug: 'bengaluru', center: [77.5946, 12.9716], zoom: 11 },
];

export const DEFAULT_CITY = CITIES[0];

export const COUNTRIES = [...new Set(CITIES.map((c) => c.country))];

export function citiesInCountry(country: string): City[] {
  return CITIES.filter((c) => c.country === country);
}

export function cityBySlug(slug: string | null | undefined): City {
  return CITIES.find((c) => c.slug === slug) ?? DEFAULT_CITY;
}
