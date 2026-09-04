'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { cityBySlug } from '@/lib/cities';
import { useCities } from '@/lib/useCities';
import { webglAvailable } from '@/lib/webgl';
import type { Pin } from '@/lib/types';
import CompanyPanel from './CompanyPanel';
import AlertToggle from './AlertToggle';

/**
 * Client boundary + data owner for the map.
 *
 * The selected city comes from the URL (?city=slug), written by
 * CitySelector — one fetch per city selection, then all interaction
 * is local. `ssr: false` is required because MapLibre touches `window`.
 */
const loading = () => (
  <div className="map-container map-loading" role="status" aria-live="polite">
    Loading map…
  </div>
);

/** Primary: MapLibre (vector, WebGL). Fallback: Leaflet (raster, no WebGL). */
const JobMap = dynamic(() => import('./JobMap'), { ssr: false, loading });
const JobMapLeaflet = dynamic(() => import('./JobMapLeaflet'), { ssr: false, loading });

export default function MapShell() {
  const params = useSearchParams();
  const cities = useCities();
  const city = cityBySlug(cities, params.get('city'));
  const cat = params.get('cat');
  const company = params.get('company');
  const [pins, setPins] = useState<Pin[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pin | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [engine, setEngine] = useState<'maplibre' | 'leaflet' | null>(null);

  // Refresh pins when the tab regains focus so counts don't go stale while
  // the worker updates data behind the scenes.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setRetryKey((k) => k + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Only offices with matching open roles get a pin.
  const visiblePins = pins.filter((p) => p.open_jobs > 0);

  // Decide the map engine on the client once WebGL can be probed.
  useEffect(() => {
    setEngine(webglAvailable() ? 'maplibre' : 'leaflet');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setSelected(null);
    const q = new URLSearchParams({ city: city.slug });
    if (cat) q.set('cat', cat);
    if (company) q.set('company', company);
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
  }, [city.slug, cat, company, retryKey]);

  // Company chosen → focus its office: select the pin and fly there.
  const [focus, setFocus] = useState<{ center: [number, number]; zoom: number } | null>(null);
  useEffect(() => {
    if (!company || status !== 'ready') return;
    const pin = pins.find((p) => p.company_slug === company && p.open_jobs > 0) ?? pins.find((p) => p.company_slug === company);
    if (!pin) return;
    setSelected(pin);
    setFocus({ center: [pin.lng, pin.lat], zoom: Math.max(city.zoom, 13) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, status, pins]);

  return (
    <>
      {engine === null && loading()}
      {engine === 'maplibre' && (
        <JobMap
          city={city}
          focus={focus}
          pins={visiblePins}
          selectedId={selected?.location_id ?? null}
          onSelect={setSelected}
        />
      )}
      {engine === 'leaflet' && (
        <JobMapLeaflet
          city={city}
          focus={focus}
          pins={visiblePins}
          selectedId={selected?.location_id ?? null}
          onSelect={setSelected}
        />
      )}
      <CompanyPanel pin={selected} category={cat} onClose={() => setSelected(null)} />
      {status === 'ready' && visiblePins.length > 0 && <AlertToggle />}
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
      {status === 'ready' && visiblePins.length === 0 && (
        <div className="map-empty" role="status">
          {company
            ? `No matching roles for this company in ${city.city} — clear the company filter.`
            : cat
              ? `No ${cat} roles in ${city.city} right now — try All roles.`
              : `No companies pinned in ${city.city} yet — we're expanding city by city.`}
        </div>
      )}
    </>
  );
}
