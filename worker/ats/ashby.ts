import type { AtsAdapter, NormalizedJob } from './types';
import { fetchJson, inferWorkplace } from './shared';

/**
 * Ashby job board adapter.
 * Public endpoint, no auth: api.ashbyhq.com/posting-api/job-board/{token}
 */

interface AshbyJob {
  id: string;
  title: string;
  department?: string;
  team?: string;
  location?: string;
  isRemote?: boolean;
  isListed?: boolean;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  employmentType?: string;
}

export const ashby: AtsAdapter = async (token) => {
  const data = (await fetchJson(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
  )) as { jobs?: AshbyJob[] };

  if (!Array.isArray(data.jobs)) {
    throw new Error(`ashby/${token}: unexpected response shape`);
  }

  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j): NormalizedJob => {
      const locationText = j.location ?? '';
      return {
        sourceJobId: j.id,
        title: j.title,
        department: j.department ?? j.team ?? undefined,
        locationText,
        applyUrl: j.jobUrl ?? j.applyUrl ?? '',
        postedAt: j.publishedAt,
        workplaceType: j.isRemote ? 'remote' : inferWorkplace(locationText),
        employmentType: j.employmentType,
      };
    })
    .filter((j) => j.applyUrl.length > 0);
};
