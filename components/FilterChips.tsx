'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cityBySlug } from '@/lib/cities';
import { homeUrl } from '@/lib/urls';

/**
 * Department filter chips. The active filter lives in the URL (?dept=),
 * so it persists across city switches and reloads, and the map + panel
 * react to it without any shared state. The chip list itself comes from
 * /api/departments for the current city; the bar hides when a city has
 * no departments (e.g. an unseeded city).
 */
export default function FilterChips() {
  const router = useRouter();
  const params = useSearchParams();
  const city = cityBySlug(params.get('city'));
  const dept = params.get('dept');

  const [departments, setDepartments] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/departments?city=${city.slug}`)
      .then((r) => r.json())
      .then((json: { departments?: string[] }) => {
        if (!cancelled) setDepartments(json.departments ?? []);
      })
      .catch(() => {
        if (!cancelled) setDepartments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [city.slug]);

  if (departments.length === 0) return null;

  function choose(d: string | null) {
    router.replace(homeUrl(city.slug, d), { scroll: false });
  }

  return (
    <nav className="chips-bar" aria-label="Filter jobs by department">
      <button
        className={dept ? 'chip' : 'chip active'}
        onClick={() => choose(null)}
        aria-pressed={!dept}
      >
        All
      </button>
      {departments.map((d) => (
        <button
          key={d}
          className={dept === d ? 'chip active' : 'chip'}
          onClick={() => choose(d)}
          aria-pressed={dept === d}
        >
          {d}
        </button>
      ))}
    </nav>
  );
}
