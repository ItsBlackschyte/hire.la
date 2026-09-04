'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Supercluster from 'supercluster';
import type { City } from '@/lib/cities';
import type { Pin } from '@/lib/types';
import { clusterHtml, pinHtml } from '@/lib/markers';

/**
 * Fallback map for browsers without WebGL (MapLibre can't run there).
 * Leaflet draws with plain <img> tiles, so it works on anything.
 *
 * Same props as JobMap; MapShell picks one or the other at runtime.
 * Tiles: CARTO's free "Positron"-style raster basemap (attribution
 * required, light-usage terms) — visually matches the MapLibre style.
 */

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

interface Props {
  city: City;
  pins: Pin[];
  selectedId: string | null;
  onSelect: (pin: Pin | null) => void;
  focus?: { center: [number, number]; zoom: number } | null;
}

type PinFeature = GeoJSON.Feature<GeoJSON.Point, Pin>;

export default function JobMapLeaflet({ city, pins, selectedId, onSelect, focus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const indexRef = useRef<Supercluster<Pin> | null>(null);
  const stateRef = useRef({ selectedId, onSelect });
  stateRef.current = { selectedId, onSelect };

  // ------------------------------------------------------------- map init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [city.center[1], city.center[0]],
      zoom: Math.round(city.zoom),
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19, subdomains: 'abcd' }).addTo(map);

    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;

    map.on('moveend zoomend', () => renderMarkers(map));
    map.on('click', () => stateRef.current.onSelect(null));

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------- city → flyTo
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([city.center[1], city.center[0]], Math.round(city.zoom), { duration: 2 });
  }, [city.slug, city.center, city.zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo([focus.center[1], focus.center[0]], Math.round(focus.zoom), { duration: 1.4 });
  }, [focus]);

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
    if (mapRef.current) renderMarkers(mapRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, selectedId]);

  // ------------------------------------------------------------- markers
  function renderMarkers(map: L.Map) {
    const index = indexRef.current;
    const layer = layerRef.current;
    if (!index || !layer) return;
    layer.clearLayers();

    const b = map.getBounds();
    const clusters = index.getClusters(
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      Math.round(map.getZoom()),
    );

    for (const feature of clusters) {
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      const props = feature.properties as (Supercluster.ClusterProperties & { cluster: true }) | Pin;

      if ('cluster' in props && props.cluster) {
        const count = props.point_count;
        const clusterId = props.cluster_id;
        const leaves = index.getLeaves(clusterId, 3).map((f) => f.properties as Pin);
        const icon = L.divIcon({
          className: '',
          html: `<button class="cluster" aria-label="${count} companies — tap to zoom in">${clusterHtml(count, leaves)}</button>`,
          iconSize: [120, 40],
          iconAnchor: [60, 20],
        });
        L.marker([lat, lng], { icon })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            const zoom = index.getClusterExpansionZoom(clusterId);
            map.flyTo([lat, lng], Math.min(zoom, 16), { duration: 0.5 });
          })
          .addTo(layer);
      } else {
        const pin = props as Pin;
        const selected = pin.location_id === stateRef.current.selectedId;
        const icon = L.divIcon({
          className: '',
          html: `<button class="pin${selected ? ' selected' : ''}" aria-label="${escapeAttr(pin.company_name)}: ${pin.open_jobs} open jobs">${pinHtml(pin)}</button>`,
          iconSize: [44, 44],
        });
        L.marker([lat, lng], { icon })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            stateRef.current.onSelect(pin);
            map.panTo([lat, lng], { animate: true, duration: 0.45 });
          })
          .addTo(layer);
      }
    }
  }

  return <div ref={containerRef} className="map-container" aria-label="Job map" />;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
