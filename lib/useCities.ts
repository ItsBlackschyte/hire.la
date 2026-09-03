'use client';

import { useEffect, useState } from 'react';
import { FALLBACK_CITIES, type City } from './cities';

/**
 * The live city list, fetched once per page load and shared by every caller
 * (module-level cache), starting from the static fallback so nothing waits.
 */

let cache: City[] | null = null;
let inflight: Promise<City[]> | null = null;

async function load(): Promise<City[]> {
  if (cache) return cache;
  inflight ??= fetch('/api/cities')
    .then((r) => r.json())
    .then((json: { cities?: City[] }) => {
      cache = json.cities && json.cities.length > 0 ? json.cities : FALLBACK_CITIES;
      return cache;
    })
    .catch(() => FALLBACK_CITIES);
  return inflight;
}

export function useCities(): City[] {
  const [cities, setCities] = useState<City[]>(cache ?? FALLBACK_CITIES);
  useEffect(() => {
    let cancelled = false;
    load().then((list) => {
      if (!cancelled) setCities(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return cities;
}
