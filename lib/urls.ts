/** URL builders — the URL is the app's single source of truth for city, role and company. */

export interface HomeParams {
  city: string;
  cat?: string | null;
  company?: string | null;
}

export function homeUrl(p: HomeParams | string, cat?: string | null, company?: string | null): string {
  const params = typeof p === 'string' ? { city: p, cat, company } : p;
  const q = new URLSearchParams({ city: params.city });
  if (params.cat) q.set('cat', params.cat);
  if (params.company) q.set('company', params.company);
  return `/?${q.toString()}`;
}
