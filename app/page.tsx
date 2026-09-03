import { Suspense } from 'react';
import MapShell from '@/components/MapShell';
import Sidebar from '@/components/Sidebar';

export default function Home() {
  return (
    <div className="app-frame">
      <h1 className="sr-only">hire.la — tech jobs on the map, city by city</h1>
      <Sidebar />
      <main className="map-main">
        <Suspense fallback={<div className="map-container map-loading">Loading map…</div>}>
          <MapShell />
        </Suspense>
      </main>
    </div>
  );
}
