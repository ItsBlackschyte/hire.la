import { Suspense } from 'react';
import MapShell from '@/components/MapShell';
import CitySelector from '@/components/CitySelector';
import FilterChips from '@/components/FilterChips';

export default function Home() {
  return (
    <div className="app-frame">
      <h1 className="sr-only">hire.la — tech jobs on the map, city by city</h1>
      <header className="topbar">
        <span className="wordmark">
          hire<span className="wordmark-tld">.la</span>
        </span>
        <div className="topbar-right">
          <Suspense fallback={null}>
            <CitySelector />
          </Suspense>
          <a className="topbar-about" href="/about">
            About
          </a>
        </div>
      </header>
      <Suspense fallback={null}>
        <FilterChips />
      </Suspense>
      <main className="map-main">
        <Suspense
          fallback={<div className="map-container map-loading">Loading map…</div>}
        >
          <MapShell />
        </Suspense>
      </main>
    </div>
  );
}
