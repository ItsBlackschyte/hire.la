'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cityBySlug } from '@/lib/cities';
import { homeUrl } from '@/lib/urls';

interface CategoryCount {
  name: string;
  count: number;
}

/**
 * Role-category filter. The active category lives in the URL (?cat=), so it
 * persists across city switches and reloads. Categories come from
 * /api/categories for the current city (normalized by lib/categorize.ts —
 * never the companies' raw department names).
 */
export default function FilterChips() {
  const router = useRouter();
  const params = useSearchParams();
  const city = cityBySlug(params.get('city'));
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

  if (categories.length === 0 && !cat) return null;

  const total = categories.reduce((s, c) => s + c.count, 0);
  const list =
    cat && !categories.some((c) => c.name === cat)
      ? [{ name: cat, count: 0 }, ...categories]
      : categories;

  function choose(c: string | null) {
    router.replace(homeUrl(city.slug, c), { scroll: false });
  }

  return (
    <nav className="chips-bar" aria-label="Filter jobs by role">
      <button className={cat ? 'chip' : 'chip active'} onClick={() => choose(null)} aria-pressed={!cat}>
        <span className="chip-label">All roles</span>
        <span className="chip-count">{total}</span>
      </button>
      {list.map((c) => (
        <button
          key={c.name}
          className={cat === c.name ? 'chip active' : 'chip'}
          onClick={() => choose(c.name)}
          aria-pressed={cat === c.name}
        >
          <span className="chip-label">{c.name}</span>
          <span className="chip-count">{c.count}</span>
        </button>
      ))}
    </nav>
  );
}
