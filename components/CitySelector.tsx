'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { citiesInCountry, cityBySlug, countriesOf } from '@/lib/cities';
import { useCities } from '@/lib/useCities';
import { homeUrl } from '@/lib/urls';

/**
 * Cascading country → city selector, driven by the live city list
 * (auto-discovered from job locations). The URL (?city=slug) is the single
 * source of truth; the active role filter (?cat=) is preserved.
 */
export default function CitySelector() {
  const router = useRouter();
  const params = useSearchParams();
  const cities = useCities();
  const current = cityBySlug(cities, params.get('city'));
  const cat = params.get('cat');

  function go(slug: string) {
    router.replace(homeUrl(slug, cat), { scroll: false });
  }

  function onCountryChange(country: string) {
    const first = citiesInCountry(cities, country)[0];
    if (first) go(first.slug);
  }

  const countries = countriesOf(cities);
  const inCountry = citiesInCountry(cities, current.country);

  return (
    <div className="selector">
      <label className="field">
        <span className="field-label">Country</span>
        <select value={current.country} onChange={(e) => onCountryChange(e.target.value)}>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">City</span>
        <select value={current.slug} onChange={(e) => go(e.target.value)}>
          {inCountry.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.city}{c.region ? `, ${c.region}` : ''}{c.jobs ? ` (${c.jobs.toLocaleString()})` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
