import type { Pin } from './types';
import { initials } from './format';

/**
 * Marker markup shared by both map engines (MapLibre DOM markers and
 * Leaflet divIcons). Pure string builders — no framework involved.
 */

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A company pin: logo (or monogram) with the company name below. */
export function pinHtml(pin: Pin): string {
  const face = pin.logo_url
    ? `<img class="pin-logo" src="${esc(pin.logo_url)}" alt="" loading="lazy" decoding="async" />`
    : `<span class="pin-mono">${esc(initials(pin.company_name))}</span>`;
  return `${face}<span class="pin-label">${esc(pin.company_name)}</span>`;
}

/** A cluster: up to three mini-logos and the company count. */
export function clusterHtml(count: number, leaves: Pin[]): string {
  const logos = leaves
    .slice(0, 3)
    .map((p) =>
      p.logo_url
        ? `<img class="cluster-logo" src="${esc(p.logo_url)}" alt="" loading="lazy" decoding="async" />`
        : `<span class="cluster-logo cluster-mono">${esc(initials(p.company_name).slice(0, 1))}</span>`,
    )
    .join('');
  return `<span class="cluster-logos">${logos}</span><span class="cluster-count">${count}</span>`;
}
