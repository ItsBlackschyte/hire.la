'use client';

import { useEffect, useState } from 'react';

/**
 * Client-side user settings (no account needed) — persisted in localStorage
 * and broadcast via a window event so any component can react.
 */

export const MAP_STYLES = [
  { id: 'positron', label: 'Positron (light, minimal)', url: 'https://tiles.openfreemap.org/styles/positron' },
  { id: 'liberty', label: 'Liberty (classic map)', url: 'https://tiles.openfreemap.org/styles/liberty' },
  { id: 'bright', label: 'Bright (detailed)', url: 'https://tiles.openfreemap.org/styles/bright' },
  { id: 'dark', label: 'Dark', url: 'https://tiles.openfreemap.org/styles/dark' },
] as const;

export type MapStyleId = (typeof MAP_STYLES)[number]['id'];

const KEY = 'hire-la:map-style';
const EVENT = 'hire-la:map-style';

export function getMapStyle(): MapStyleId {
  if (typeof window === 'undefined') return 'positron';
  const v = window.localStorage.getItem(KEY);
  return MAP_STYLES.some((s) => s.id === v) ? (v as MapStyleId) : 'positron';
}

export function setMapStyle(id: MapStyleId) {
  window.localStorage.setItem(KEY, id);
  document.documentElement.dataset.mapStyle = id;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

export function mapStyleUrl(id: MapStyleId): string {
  return MAP_STYLES.find((s) => s.id === id)!.url;
}

/** Null until the stored preference has been read on the client. */
export function useMapStyle(): MapStyleId | null {
  const [style, setStyle] = useState<MapStyleId | null>(null);
  useEffect(() => {
    const current = getMapStyle();
    setStyle(current);
    document.documentElement.dataset.mapStyle = current;
    const onChange = (e: Event) => setStyle((e as CustomEvent<MapStyleId>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return style;
}
