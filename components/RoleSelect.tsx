'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cityBySlug } from '@/lib/cities';
import { useCities } from '@/lib/useCities';
import { homeUrl } from '@/lib/urls';

interface CategoryCount {
  name: string;
  count: number;
}

/**
 * Role filter as a dropdown, matching the country/city selectors. The active
 * role lives in the URL (?cat=) so it persists across cities and reloads.
 * Options come from /api/categories (SQL-aggregated counts).
 */
export default function RoleSelect() {
  const router = useRouter();
  const params = useSearchParams();
  const cities = useCities();
  const city = cityBySlug(cities, params.get('city'));
  const cat = params.get('cat');

  const [categories, setCategories] = useState<CategoryCount[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/categories?city=${city.slug}`)
      .then((r) => r.json())
      .then((json: { categories?: CategoryCount[] }) => {
        if (!cancelled) setCategories(json.categories ?? []);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [city.slug]);

  const total = categories.reduce((s, c) => s + c.count, 0);
  const list =
    cat && !categories.some((c) => c.name === cat) ? [{ name: cat, count: 0 }, ...categories] : categories;

  return (
    <label className="field">
      <span className="field-label">Role</span>
      <select
        value={cat ?? ''}
        onChange={(e) => router.replace(homeUrl(city.slug, e.target.value || null), { scroll: false })}
        aria-label="Filter jobs by role"
      >
        <option value="">All roles{total ? ` (${total.toLocaleString()})` : ''}</option>
        {list.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name} ({c.count.toLocaleString()})
          </option>
        ))}
      </select>
    </label>
  );
}
