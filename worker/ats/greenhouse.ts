import type { AtsAdapter, NormalizedJob } from './types';
import { fetchJson, inferWorkplace } from './shared';

/**
 * Greenhouse job board adapter.
 * Public endpoint, no auth: boards-api.greenhouse.io/v1/boards/{token}/jobs
 * Descriptions are NOT fetched here (see lib/ats-description.ts) — keeps the
 * payload small: SpaceX's board is ~1 MB without content, ~15 MB with.
 */

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  offices?: Array<{ name?: string }>;
  departments?: Array<{ name?: string }>;
}

export const greenhouse: AtsAdapter = async (token) => {
  const data = (await fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`,
  )) as { jobs?: GhJob[] };

  if (!Array.isArray(data.jobs)) {
    throw new Error(`greenhouse/${token}: unexpected response shape`);
  }

  return data.jobs.map((j): NormalizedJob => {
    const locationText = j.location?.name ?? j.offices?.[0]?.name ?? '';
    return {
      sourceJobId: String(j.id),
      title: j.title,
      department: j.departments?.[0]?.name || undefined,
      locationText,
      applyUrl: j.absolute_url,
      postedAt: j.first_published ?? j.updated_at,
      workplaceType: inferWorkplace(locationText),
    };
  });
};
