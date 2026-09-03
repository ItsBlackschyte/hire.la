import type { AtsAdapter, NormalizedJob } from './types';
import { fetchJson, inferWorkplace } from './shared';

/**
 * Lever postings adapter.
 * Public endpoint, no auth: api.lever.co/v0/postings/{token}?mode=json
 */

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  description?: string;
  workplaceType?: string;
  categories?: {
    team?: string;
    department?: string;
    location?: string;
    commitment?: string;
  };
}

function mapWorkplace(w: string | undefined, locationText: string): NormalizedJob['workplaceType'] {
  const v = (w ?? '').toLowerCase();
  if (v === 'remote') return 'remote';
  if (v === 'hybrid') return 'hybrid';
  if (v === 'on-site' || v === 'onsite') return 'onsite';
  return inferWorkplace(locationText);
}

export const lever: AtsAdapter = async (token) => {
  const data = await fetchJson(
    `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`,
  );

  if (!Array.isArray(data)) {
    throw new Error(`lever/${token}: unexpected response shape`);
  }

  return (data as LeverPosting[]).map((p): NormalizedJob => {
    const locationText = p.categories?.location ?? '';
    return {
      sourceJobId: p.id,
      title: p.text,
      department: p.categories?.department ?? p.categories?.team ?? undefined,
      locationText,
      applyUrl: p.hostedUrl ?? p.applyUrl ?? '',
      descriptionHtml: p.description || undefined,
      postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
      workplaceType: mapWorkplace(p.workplaceType, locationText),
      employmentType: p.categories?.commitment,
    };
  }).filter((j) => j.applyUrl.length > 0);
};
