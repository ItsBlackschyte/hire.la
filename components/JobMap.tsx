'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Supercluster from 'supercluster';
import type { City } from '@/lib/cities';
import type { Pin } from '@/lib/types';
import { webglAvailable } from '@/lib/webgl';
import { getMapStyle, mapStyleUrl, useMapStyle } from '@/lib/settings';
import { clusterHtml, pinHtml } from '@/lib/markers';

/**
 * The map (MapLibre engine). Client-only, mounted via dynamic import.
 *
 * Pins are clustered client-side with supercluster over the pins already
 * fetched for the selected city — zooming never triggers a network request.
 *
 * Markers are keyed DOM elements diffed on every animation frame of a
 * pan/zoom: persisting markers are updated in place, new ones scale/fade in,
 * departing ones fade out. That's what makes cluster merge/split feel
 * continuous instead of popping at the end of the gesture.
 *
 * maplibre-gl is pinned to v5: v6's ESM build spawns a module worker via
 * import.meta.url, which Next/Turbopack can't resolve. See SETUP.md.
 */

interface Props {
  city: City;
  pins: Pin[];
  selectedId: string | null;
  onSelect: (pin: Pin | null) => void;
}

type PinFeature = GeoJSON.Feature<GeoJSON.Point, Pin>;
type ClusterProps = Supercluster.ClusterProperties & { cluster: true };

export default function JobMap({ city, pins, selectedId, onSelect }: Props) {
  const [mapError, setMapError] = useState<string | null>(null);
  const mapStyle = useMapStyle();
  const styleUrlRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  /** Latest pin data per marker key — click handlers read from here, so they never act on stale objects. */
  const latestPinRef = useRef<Map<string, Pin>>(new Map());
  const indexRef = useRef<Supercluster<Pin> | null>(null);
  const frameRef = useRef<number | null>(null);
  /** What the last render covered: skip re-clustering while the view stays inside it at the same zoom. */
  const lastRenderRef = useRef<{ zoom: number; bounds: [number, number, number, number] } | null>(null);

  // Latest values reachable from map event handlers without re-binding.
  const stateRef = useRef({ selectedId, onSelect });
  stateRef.current = { selectedId, onSelect };

  // ------------------------------------------------------------- map init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    if (!webglAvailable()) {
      setMapError('WebGL is unavailable in this browser — the map needs it.');
      return;
    }

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: (styleUrlRef.current = mapStyleUrl(getMapStyle())),
        center: city.center,
        zoom: city.zoom,
        attributionControl: { compact: true },
      });
    } catch (err) {
      setMapError(`Map failed to start: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Some basemap styles reference POI icons their sprite doesn't ship; give
    // MapLibre a blank image instead of a console warning per icon.
    map.on('styleimagemissing', (e) => {
      if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });

    map.on('error', (e) => {
      const msg = e?.error?.message ?? 'unknown error';
      if (/style|tiles\.openfreemap|fetch|network|Failed to/i.test(msg)) {
        setMapError(`Map data could not be loaded (${msg}). Check that tiles.openfreemap.org is reachable.`);
      }
      console.error('[maplibre]', msg);
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.touchZoomRotate.disableRotation();

    // rAF-throttled; renderMarkers itself skips work while the view stays
    // within the last padded render at the same integer zoom.
    const schedule = () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        renderMarkers(map);
      });
    };
    map.on('move', schedule);
    map.on('moveend', schedule);
    map.on('load', () => renderMarkers(map, true));
    map.on('click', () => stateRef.current.onSelect(null));

    mapRef.current = map;
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // The map is created exactly once; city changes are handled by flyTo below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------- settings → style
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapStyle) return;
    const url = mapStyleUrl(mapStyle);
    if (styleUrlRef.current === url) return; // already showing this style
    styleUrlRef.current = url;
    map.setStyle(url);
  }, [mapStyle]);

  // ------------------------------------------------------- city → flyTo
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: city.center, zoom: city.zoom, duration: 2200, essential: true });
  }, [city.slug, city.center, city.zoom]);

  // ------------------------------------------------- pins → cluster index
  useEffect(() => {
    const index = new Supercluster<Pin>({ radius: 44, maxZoom: 16 });
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
    if (mapRef.current) renderMarkers(mapRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, selectedId]);

  // ------------------------------------------------------------- markers
  function renderMarkers(map: maplibregl.Map, force = false) {
    const index = indexRef.current;
    if (!index) return;
    const markers = markersRef.current;

    const zoom = Math.floor(map.getZoom());
    const b = map.getBounds();
    const view: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];

    // Still inside the last padded render at the same zoom? Nothing to do —
    // this is what stops pins flickering during a pan or a partial scroll notch.
    const last = lastRenderRef.current;
    if (!force && last && last.zoom === zoom && within(view, last.bounds)) return;

    // Render 1.5× the viewport so edge pins exist before they scroll into view.
    const padX = (view[2] - view[0]) * 0.5;
    const padY = (view[3] - view[1]) * 0.5;
    const padded: [number, number, number, number] = [
      Math.max(-180, view[0] - padX),
      Math.max(-85, view[1] - padY),
      Math.min(180, view[2] + padX),
      Math.min(85, view[3] + padY),
    ];
    lastRenderRef.current = { zoom, bounds: padded };

    const clusters = index.getClusters(padded, zoom);

    const seen = new Set<string>();

    for (const feature of clusters) {
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      const props = feature.properties as ClusterProps | Pin;
      const isCluster = 'cluster' in props && props.cluster === true;
      const key = isCluster ? `c-${(props as ClusterProps).cluster_id}` : `p-${(props as Pin).location_id}`;
      seen.add(key);

      let marker = markers.get(key);
      if (!marker) {
        const el = document.createElement('button');
        el.classList.add('marker-enter');
        if (isCluster) {
          const { point_count: count, cluster_id: clusterId } = props as ClusterProps;
          const leaves = index.getLeaves(clusterId, 3).map((f) => f.properties as Pin);
          el.innerHTML = clusterHtml(count, leaves);
          el.setAttribute('aria-label', `${count} companies — tap to zoom in`);
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const zoom = index.getClusterExpansionZoom(clusterId);
            map.easeTo({ center: [lng, lat], zoom: Math.min(zoom, 16), duration: 500 });
          });
        } else {
          el.innerHTML = pinHtml(props as Pin);
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const latest = latestPinRef.current.get(key);
            if (!latest) return;
            stateRef.current.onSelect(latest);
            map.easeTo({ center: [latest.lng, latest.lat], duration: 450 });
          });
        }
        marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
        markers.set(key, marker);
        requestAnimationFrame(() => el.classList.remove('marker-enter'));
      }

      // Refresh everything that can change without re-creating the marker:
      // the count label (filters change it), aria text, selection class,
      // and the pin object the click handler will use.
      const el = marker.getElement();
      const entering = el.classList.contains('marker-enter') ? ' marker-enter' : '';
      if (isCluster) {
        el.className = `cluster${entering}`;
      } else {
        const pin = props as Pin;
        latestPinRef.current.set(key, pin);
        el.setAttribute('aria-label', `${pin.company_name}: ${pin.open_jobs} open jobs`);
        const selected = pin.location_id === stateRef.current.selectedId;
        el.className = `pin${selected ? ' selected' : ''}${entering}`;
      }
    }

    // Exit: fade out, then remove.
    for (const [key, marker] of markers) {
      if (seen.has(key)) continue;
      markers.delete(key);
      latestPinRef.current.delete(key);
      const el = marker.getElement();
      el.classList.add('marker-exit');
      setTimeout(() => marker.remove(), 140);
    }
  }

  return (
    <>
      <div ref={containerRef} className="map-container" aria-label="Job map" />
      {mapError && (
        <div className="map-empty" role="alert">
          {mapError}
        </div>
      )}
    </>
  );
}

function within(inner: [number, number, number, number], outer: [number, number, number, number]): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}
