'use client';

import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Supercluster from 'supercluster';
import type { City } from '@/lib/cities';
import type { Pin } from '@/lib/types';

/**
 * The map. Client-only (mounted via dynamic import, ssr:false).
 *
 * Pins are clustered client-side with supercluster over the pins already
 * fetched for the selected city — zooming never triggers a network request.
 * Markers are plain DOM elements (styled in globals.css) managed on every
 * moveend/zoom; at our scale, tearing down and re-adding them is simpler
 * and fast enough.
 */

// maplibre-gl is pinned to v5: v6's ESM build spawns a module worker via
// import.meta.url, which Next/Turbopack can't resolve (blank map, console
// "Failed to load module script"). See SETUP.md → Troubleshooting.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

interface Props {
  city: City;
  pins: Pin[];
  selectedId: string | null;
  onSelect: (pin: Pin | null) => void;
}

type PinFeature = GeoJSON.Feature<GeoJSON.Point, Pin>;

export default function JobMap({ city, pins, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const indexRef = useRef<Supercluster<Pin> | null>(null);

  // Keep latest values reachable from map event handlers without re-binding.
  const stateRef = useRef({ selectedId, onSelect });
  stateRef.current = { selectedId, onSelect };

  // ------------------------------------------------------------- map init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: city.center,
      zoom: city.zoom,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.touchZoomRotate.disableRotation();

    const rerender = () => renderMarkers(map);
    map.on('moveend', rerender);
    map.on('load', rerender);
    map.on('click', () => stateRef.current.onSelect(null));

    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
    // The map is created exactly once; city changes are handled by flyTo below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------- city → flyTo
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: city.center, zoom: city.zoom, duration: 2200, essential: true });
  }, [city.slug, city.center, city.zoom]);

  // ------------------------------------------------- pins → cluster index
  useEffect(() => {
    const index = new Supercluster<Pin>({ radius: 60, maxZoom: 15 });
    index.load(
      pins.map(
        (p): PinFeature => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: p,
        }),
      ),
    );
    indexRef.current = index;
    const map = mapRef.current;
    if (map) renderMarkers(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, selectedId]);

  // ------------------------------------------------------------- markers
  function renderMarkers(map: maplibregl.Map) {
    const index = indexRef.current;
    if (!index) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const b = map.getBounds();
    const clusters = index.getClusters(
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      Math.round(map.getZoom()),
    );

    for (const feature of clusters) {
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      const el = document.createElement('button');
      const props = feature.properties as (Supercluster.ClusterProperties & { cluster: true }) | Pin;

      if ('cluster' in props && props.cluster) {
        const count = props.point_count;
        const clusterId = props.cluster_id;
        el.className = 'cluster';
        el.textContent = String(count);
        el.setAttribute('aria-label', `${count} companies — tap to zoom in`);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const zoom = index.getClusterExpansionZoom(clusterId);
          map.easeTo({ center: [lng, lat], zoom: Math.min(zoom, 16), duration: 500 });
        });
      } else {
        const pin = props as Pin;
        const selected = pin.location_id === stateRef.current.selectedId;
        el.className = selected ? 'pin selected' : 'pin';
        el.textContent = String(pin.open_jobs);
        el.setAttribute('aria-label', `${pin.company_name}: ${pin.open_jobs} open jobs`);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          stateRef.current.onSelect(pin);
          map.easeTo({ center: [lng, lat], duration: 450 });
        });
      }

      const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      markersRef.current.push(marker);
    }
  }

  return <div ref={containerRef} className="map-container" aria-label="Job map" />;
}
