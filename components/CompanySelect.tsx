'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cityBySlug } from '@/lib/cities';
import { useCities } from '@/lib/useCities';
import { homeUrl } from '@/lib/urls';
import { initials } from '@/lib/format';

interface CompanyOption {
  slug: string;
  name: string;
  logo_url: string | null;
  jobs: number;
}

/**
 * Searchable company filter. Lists companies with jobs in the selected city;
 * choosing one sets ?company=slug (pins filter to it, the map flies to its
 * office, the panel opens). Keyboard: ↑/↓ move, Enter selects, Esc closes.
 */
export default function CompanySelect() {
  const router = useRouter();
  const params = useSearchParams();
  const cities = useCities();
  const city = cityBySlug(cities, params.get('city'));
  const cat = params.get('cat');
  const selectedSlug = params.get('company');

  const [options, setOptions] = useState<CompanyOption[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/companies?city=${city.slug}`)
      .then((r) => r.json())
      .then((json: { companies?: CompanyOption[] }) => {
        if (!cancelled) setOptions(json.companies ?? []);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [city.slug]);

  const selected = options.find((o) => o.slug === selectedSlug) ?? null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
    return list.slice(0, q ? 12 : 8);
  }, [options, query]);

  function choose(slug: string | null) {
    router.replace(homeUrl({ city: city.slug, cat, company: slug }), { scroll: false });
    setQuery('');
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) choose(results[active].slug); }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  }

  if (options.length === 0 && !selectedSlug) return null;

  return (
    <div className="field combobox">
      <span className="field-label">Company</span>

      {selected ? (
        <div className="combobox-selected">
          <Avatar option={selected} />
          <span className="combobox-selected-name">{selected.name}</span>
          <span className="combobox-count">{selected.jobs.toLocaleString()}</span>
          <button className="combobox-clear" onClick={() => choose(null)} aria-label="Clear company filter">×</button>
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="company-listbox"
          aria-autocomplete="list"
          placeholder={`Search ${options.length.toLocaleString()} companies…`}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
        />
      )}

      {open && !selected && (
        <ul id="company-listbox" role="listbox" className="combobox-list">
          {results.length === 0 && <li className="combobox-empty">No companies match “{query}”</li>}
          {results.map((o, i) => (
            <li
              key={o.slug}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'combobox-item active' : 'combobox-item'}
              onMouseDown={(e) => { e.preventDefault(); choose(o.slug); }}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar option={o} />
              <span className="combobox-name">{o.name}</span>
              <span className="combobox-count">{o.jobs.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Avatar({ option }: { option: CompanyOption }) {
  return option.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="combobox-logo" src={option.logo_url} alt="" width={22} height={22} />
  ) : (
    <span className="combobox-logo combobox-mono">{initials(option.name).slice(0, 1)}</span>
  );
}
