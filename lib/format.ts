/** Tiny formatting helpers used by the panel and (later) job pages. */

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function workplaceLabel(w: 'onsite' | 'hybrid' | 'remote' | null): string | null {
  if (!w) return null;
  return w === 'onsite' ? 'On-site' : w === 'hybrid' ? 'Hybrid' : 'Remote';
}
