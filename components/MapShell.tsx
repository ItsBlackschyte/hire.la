'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { cityBySlug } from '@/lib/cities';
import type { Pin } from '@/lib/types';
import CompanyPanel from './CompanyPanel';

/**
 * Client boundary + data owner for the map.
 *
 * The selected city comes from the URL (?city=slug), written by
 * CitySelector — one fetch per city selection, then all interaction
 * is local. `ssr: false` is required because MapLibre touches `window`.
 */
const JobMap = dynamic(() => import('./JobMap'), {
  ssr: false,
  loading: () => (
    <div className="map-container map-loading" role="status" aria-live="polite">
      Loading map…
    </div>
  ),
});

export default function MapShell() {
  const params = useSearchParams();
  const city = cityBySlug(params.get('city'));
  const dept = params.get('dept');
  const [pins, setPins] = useState<Pin[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pin | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setSelected(null);
    const q = new URLSearchParams({ city: city.slug });
    if (dept) q.set('dept', dept);
    fetch(`/api/pins?${q.toString()}`)
      .then(async (r) => {
        const json = (await r.json().catch(() => ({}))) as { pins?: Pin[]; error?: string };
        if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        setPins(json.pins ?? []);
        setErrorDetail(null);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPins([]);
        setErrorDetail(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [city.slug, dept, retryKey]);

  return (
    <>
      <JobMap
        city={city}
        pins={pins}
        selectedId={selected?.location_id ?? null}
        onSelect={setSelected}
      />
      <CompanyPanel pin={selected} dept={dept} onClose={() => setSelected(null)} />
      {status === 'loading' && (
        <div className="map-status" role="status">Loading companies…</div>
      )}
      {status === 'error' && (
        <div className="map-empty" role="alert">
          Couldn&apos;t load companies.{' '}
          <button className="link-button" onClick={() => setRetryKey((k) => k + 1)}>
            Retry
          </button>
          {errorDetail && <div className="map-error-detail">{errorDetail}</div>}
        </div>
      )}
      {status === 'ready' && pins.length === 0 && (
        <div className="map-empty" role="status">
          {dept
            ? `No ${dept} roles in ${city.city} right now — try All.`
            : `No companies pinned in ${city.city} yet — we're expanding city by city.`}
        </div>
      )}
    </>
  );
}
