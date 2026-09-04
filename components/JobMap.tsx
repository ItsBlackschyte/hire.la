'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { City } from '@/lib/cities';
import type { Pin } from '@/lib/types';
import { webglAvailable } from '@/lib/webgl';
import { getMapStyle, mapStyleUrl, useMapStyle } from '@/lib/settings';
import { initials } from '@/lib/format';

/**
 * The map (MapLibre engine). Client-only, mounted via dynamic import.
 *
 * Pins are rendered the way production map products do it: a GeoJSON source
 * with WebGL symbol layers, not HTML markers. Positions are computed on the
 * GPU every frame (nothing can drift), clustering is native to the source
 * with a small radius (pins merge only when they genuinely overlap), and
 * label collision is handled by the renderer (overlapping names hide
 * instead of forcing pins to merge).
 *
 * Logos become map icons: drawn onto a canvas (white circle + border) and
 * added lazily via `styleimagemissing` as pins come into view.
 *
 * maplibre-gl is pinned to v5 (v6's module worker breaks under Next).
 */

interface Props {
  city: City;
  pins: Pin[];
  selectedId: string | null;
  onSelect: (pin: Pin | null) => void;
}

const SRC = 'pins';
const ICON_PX = 44; // rendered size of a pin
const CLUSTER_RADIUS_PX = 22; // merge only when centers are this close (~half a pin)
const INK = '#111418';

export default function JobMap({ city, pins, selectedId, onSelect }: Props) {
  const [mapError, setMapError] = useState<string | null>(null);
  const mapStyle = useMapStyle();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleUrlRef = useRef<string | null>(null);
  const pinsRef = useRef<Pin[]>(pins);
  const pinById = useRef<Map<string, Pin>>(new Map());
  const iconCache = useRef<Map<string, ImageData>>(new Map());
  const stateRef = useRef({ selectedId, onSelect });
  stateRef.current = { selectedId, onSelect };
  pinsRef.current = pins;

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

    map.on('error', (e) => {
      const msg = e?.error?.message ?? 'unknown error';
      if (/style|tiles\.openfreemap|fetch|network|Failed to/i.test(msg)) {
        setMapError(`Map data could not be loaded (${msg}). Check that tiles.openfreemap.org is reachable.`);
      }
      console.error('[maplibre]', msg);
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.touchZoomRotate.disableRotation();

    // Icons on demand: our pin icons, plus blanks for basemap sprites the style lacks.
    map.on('styleimagemissing', (e) => {
      const id = e.id;
      if (map.hasImage(id)) return;
      if (id.startsWith('cluster:')) {
        const cached = iconCache.current.get(id);
        if (cached) {
          map.addImage(id, cached, { pixelRatio: 2 });
          return;
        }
        const { slugs, count } = parseClusterId(id);
        // Immediate: pill with grey discs + count. Then: real logos when loaded.
        map.addImage(id, drawClusterPill(slugs, count, pinsRef.current, null), { pixelRatio: 2 });
        loadClusterLogos(slugs, pinsRef.current).then((imgs) => {
          const full = drawClusterPill(slugs, count, pinsRef.current, imgs);
          iconCache.current.set(id, full);
          if (map.hasImage(id)) map.removeImage(id);
          map.addImage(id, full, { pixelRatio: 2 });
          map.triggerRepaint();
        });
        return;
      }
      if (id.startsWith('logo:') || id.startsWith('mono:')) {
        const cached = iconCache.current.get(id);
        if (cached) {
          map.addImage(id, cached, { pixelRatio: 2 });
          return;
        }
        // Placeholder now (so the renderer stops asking), real icon when drawn.
        map.addImage(id, blankImage(ICON_PX * 2), { pixelRatio: 2 });
        drawIcon(id, pinsRef.current).then((img) => {
          if (!img) return;
          iconCache.current.set(id, img);
          if (map.hasImage(id)) map.removeImage(id);
          map.addImage(id, img, { pixelRatio: 2 });
          map.triggerRepaint();
        });
      } else {
        map.addImage(id, blankImage(1));
      }
    });

    // Source + layers, (re)installed whenever a style loads (initial + style switch).
    map.on('style.load', () => installLayers(map));

    // One click handler for everything on the map.
    map.on('click', async (e) => {
      if (!map.getLayer('pins')) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: ['pins', 'clusters'] });
      const f = hits[0];
      if (!f) {
        stateRef.current.onSelect(null);
        return;
      }
      if (f.properties?.cluster) {
        const src = map.getSource(SRC) as maplibregl.GeoJSONSource;
        const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        map.easeTo({ center: [lng, lat], zoom: Math.min(zoom, 18), duration: 500 });
        return;
      }
      const pin = pinById.current.get(String(f.properties?.location_id));
      if (pin) {
        stateRef.current.onSelect(pin);
        map.easeTo({ center: [pin.lng, pin.lat], duration: 450 });
      }
    });

    // Pointer feedback + hover ring.
    let hovered: string | null = null;
    map.on('mousemove', (e) => {
      if (!map.getLayer('pins')) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: ['pins', 'clusters'] });
      map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
      const id = hits[0]?.properties?.cluster ? null : ((hits[0]?.properties?.location_id as string | undefined) ?? null);
      if (id !== hovered) {
        hovered = id;
        if (map.getLayer('pin-hover')) map.setFilter('pin-hover', ['==', ['get', 'location_id'], id ?? '__none__']);
      }
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------- settings → style
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapStyle) return;
    const url = mapStyleUrl(mapStyle);
    if (styleUrlRef.current === url) return;
    styleUrlRef.current = url;
    map.setStyle(url); // 'style.load' re-installs our layers
  }, [mapStyle]);

  // ------------------------------------------------------- city → flyTo
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: city.center, zoom: city.zoom, duration: 2200, essential: true });
  }, [city.slug, city.center, city.zoom]);

  // -------------------------------------------------------- pins → data
  useEffect(() => {
    pinById.current = new Map(pins.map((p) => [p.location_id, p]));
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(toFeatureCollection(pins));
  }, [pins]);

  // ---------------------------------------------------- selection ring
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('pin-selected')) return;
    map.setFilter('pin-selected', ['==', ['get', 'location_id'], selectedId ?? '__none__']);
  }, [selectedId]);

  // ------------------------------------------------------------ layers
  function installLayers(map: maplibregl.Map) {
    if (map.getSource(SRC)) return;
    const fonts = styleFonts(map);
    const dark = getMapStyle() === 'dark';
    const text = dark ? '#ffffff' : INK;
    const halo = dark ? '#000000' : '#ffffff';

    map.addSource(SRC, {
      type: 'geojson',
      data: toFeatureCollection(pinsRef.current),
      cluster: true,
      clusterRadius: CLUSTER_RADIUS_PX,
      clusterMaxZoom: 17,
      promoteId: 'location_id',
      // Each cluster carries the slugs of (up to a few of) its member companies,
      // so its icon can show their logos. [reduce, map] expressions.
      clusterProperties: {
        logos: [
          ['case', ['>', ['length', ['accumulated']], 80], ['accumulated'], ['concat', ['accumulated'], ['get', 'logos']]],
          ['concat', ['get', 'company_slug'], '|'],
        ],
      },
    });

    map.addLayer({
      id: 'clusters',
      type: 'symbol',
      source: SRC,
      filter: ['has', 'point_count'],
      layout: {
        'icon-image': ['concat', 'cluster:', ['get', 'logos'], '#', ['get', 'point_count_abbreviated']],
        'icon-size': 1,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });

    map.addLayer({
      id: 'pin-hover',
      type: 'circle',
      source: SRC,
      filter: ['==', ['get', 'location_id'], '__none__'],
      paint: {
        'circle-radius': ICON_PX / 2 + 3,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 2,
        'circle-stroke-color': dark ? 'rgba(255,255,255,0.5)' : 'rgba(17, 20, 24, 0.35)',
      },
    });

    map.addLayer({
      id: 'pin-selected',
      type: 'circle',
      source: SRC,
      filter: ['==', ['get', 'location_id'], stateRef.current.selectedId ?? '__none__'],
      paint: {
        'circle-radius': ICON_PX / 2 + 5,
        'circle-color': 'rgba(17, 20, 24, 0.14)',
        'circle-stroke-width': 2,
        'circle-stroke-color': dark ? '#ffffff' : INK,
      },
    });

    map.addLayer({
      id: 'pins',
      type: 'symbol',
      source: SRC,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': 1,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['get', 'company_name'],
        'text-font': fonts,
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 2.1],
        'text-optional': true,           // label may hide, the pin never does
        'text-allow-overlap': false,     // overlapping names collide away — no merging needed
        'symbol-sort-key': ['*', -1, ['get', 'open_jobs']], // bigger employers keep their label
      },
      paint: {
        'text-color': text,
        'text-halo-color': halo,
        'text-halo-width': 1.6,
      },
    });
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

// ---------------------------------------------------------------- helpers

function toFeatureCollection(pins: Pin[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: pins.map((p) => ({
      type: 'Feature',
      id: p.location_id,
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        location_id: p.location_id,
        company_slug: p.company_slug,
        company_name: p.company_name,
        open_jobs: p.open_jobs,
        icon: p.logo_url ? `logo:${p.company_slug}` : `mono:${initials(p.company_name)}`,
      },
    })),
  };
}

/** Reuse a font stack the current style already has glyphs for. */
function styleFonts(map: maplibregl.Map): string[] {
  const layers = map.getStyle()?.layers ?? [];
  for (const l of layers) {
    if (l.type !== 'symbol') continue;
    const f = (l.layout as Record<string, unknown> | undefined)?.['text-font'];
    if (Array.isArray(f) && f.every((x) => typeof x === 'string')) return f as string[];
  }
  return ['Noto Sans Regular'];
}

function blankImage(size: number): ImageData {
  return new ImageData(size, size);
}

/** Draw a circular pin icon (logo or monogram) at 2× for retina. */
async function drawIcon(id: string, pins: Pin[]): Promise<ImageData | null> {
  const size = ICON_PX * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const r = size / 2;

  // soft shadow + white disc
  ctx.save();
  ctx.shadowColor = 'rgba(17,20,24,0.28)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(r, r, r - 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (id.startsWith('mono:')) {
    const letters = id.slice(5);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(r, r, r - 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${letters.length > 1 ? 26 : 30}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letters, r, r + 1);
    return ctx.getImageData(0, 0, size, size);
  }

  const slug = id.slice(5);
  const pin = pins.find((p) => p.company_slug === slug);
  if (!pin?.logo_url) return null;
  const img = await loadImage(pin.logo_url);
  if (!img) return null;

  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 8, 0, Math.PI * 2);
  ctx.clip();
  // cover-fit the logo into the disc
  const s = Math.max((size - 16) / img.width, (size - 16) / img.height);
  const w = img.width * s;
  const h = img.height * s;
  ctx.drawImage(img, r - w / 2, r - h / 2, w, h);
  ctx.restore();
  return ctx.getImageData(0, 0, size, size);
}

/** "cluster:slug-a|slug-b|slug-c|#12" → { slugs, count } */
function parseClusterId(id: string): { slugs: string[]; count: string } {
  const body = id.slice('cluster:'.length);
  const hash = body.lastIndexOf('#');
  const count = hash >= 0 ? body.slice(hash + 1) : '';
  const slugs = (hash >= 0 ? body.slice(0, hash) : body).split('|').filter(Boolean).slice(0, 3);
  return { slugs, count };
}

async function loadClusterLogos(slugs: string[], pins: Pin[]): Promise<(HTMLImageElement | null)[]> {
  return Promise.all(
    slugs.map((slug) => {
      const url = pins.find((p) => p.company_slug === slug)?.logo_url;
      return url ? loadImage(url) : Promise.resolve(null);
    }),
  );
}

/** A cluster pill: up to three overlapping mini-logo discs + the company count. 2× for retina. */
function drawClusterPill(
  slugs: string[],
  count: string,
  pins: Pin[],
  imgs: (HTMLImageElement | null)[] | null,
): ImageData {
  const H = 80;              // 40px pill
  const DISC = 56;           // 28px disc
  const STEP = 36;           // overlap spacing
  const n = Math.max(1, Math.min(slugs.length, 3));
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = '700 26px Inter, system-ui, sans-serif';
  const textW = Math.ceil(measure.measureText(count || '').width);
  const logosW = DISC + (n - 1) * STEP;
  const W = 12 + logosW + 16 + textW + 24;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // pill body
  ctx.save();
  ctx.shadowColor = 'rgba(17,20,24,0.28)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 4, 4, W - 8, H - 8, (H - 8) / 2);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  roundRect(ctx, 4, 4, W - 8, H - 8, (H - 8) / 2);
  ctx.stroke();

  // discs (draw right-to-left so the first company sits on top)
  for (let i = n - 1; i >= 0; i--) {
    const cx = 12 + DISC / 2 + i * STEP;
    const cy = H / 2;
    const slug = slugs[i];
    const img = imgs?.[i] ?? null;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, DISC / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.clip();
    if (img) {
      const s = Math.max((DISC - 8) / img.width, (DISC - 8) / img.height);
      ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
    } else {
      ctx.fillStyle = imgs ? INK : '#d1d5db';
      ctx.beginPath();
      ctx.arc(cx, cy, DISC / 2 - 4, 0, Math.PI * 2);
      ctx.fill();
      if (imgs) {
        const name = pins.find((p) => p.company_slug === slug)?.company_name ?? slug;
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 22px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials(name).slice(0, 1), cx, cy + 1);
      }
    }
    ctx.restore();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, DISC / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // count
  ctx.fillStyle = INK;
  ctx.font = '700 26px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(count, 12 + logosW + 16, H / 2 + 1);

  return ctx.getImageData(0, 0, W, H);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}