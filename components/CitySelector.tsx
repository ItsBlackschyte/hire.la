'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { COUNTRIES, citiesInCountry, cityBySlug } from '@/lib/cities';
import { homeUrl } from '@/lib/urls';

/**
 * Cascading country → city selector. The URL (?city=slug) is the single
 * source of truth: this component writes it, MapShell reads it, so the
 * selector and the map stay in sync with no shared state — and every
 * city view is a shareable link.
 */
export default function CitySelector() {
  const router = useRouter();
  const params = useSearchParams();
  const current = cityBySlug(params.get('city'));
  const dept = params.get('dept');

  function go(slug: string) {
    router.replace(homeUrl(slug, dept), { scroll: false });
  }

  function onCountryChange(country: string) {
    const first = citiesInCountry(country)[0];
    if (first) go(first.slug);
  }

  return (
    <div className="selector">
      <label className="sr-only" htmlFor="country-select">Country</label>
      <select
        id="country-select"
        value={current.country}
        onChange={(e) => onCountryChange(e.target.value)}
      >
        {COUNTRIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor="city-select">City</label>
      <select
        id="city-select"
        value={current.slug}
        onChange={(e) => go(e.target.value)}
      >
        {citiesInCountry(current.country).map((c) => (
          <option key={c.slug} value={c.slug}>{c.city}</option>
        ))}
      </select>
    </div>
  );
}
