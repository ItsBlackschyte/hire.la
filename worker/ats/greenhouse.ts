import type { AtsAdapter, NormalizedJob } from './types';
import { decodeEntities, fetchJson, inferWorkplace } from './shared';

/**
 * Greenhouse job board adapter.
 * Public endpoint, no auth: boards-api.greenhouse.io/v1/boards/{token}/jobs
 * `content=true` includes the full job description (HTML-escaped).
 */

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  content?: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  offices?: Array<{ name?: string }>;
  departments?: Array<{ name?: string }>;
}

export const greenhouse: AtsAdapter = async (token) => {
  const data = (await fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
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
      descriptionHtml: j.content ? decodeEntities(j.content) : undefined,
      postedAt: j.first_published ?? j.updated_at,
      workplaceType: inferWorkplace(locationText),
    };
  });
};
