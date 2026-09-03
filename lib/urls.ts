/** URL builders — the URL is the app's single source of truth for city + filter. */

export function homeUrl(citySlug: string, dept?: string | null): string {
  const q = new URLSearchParams({ city: citySlug });
  if (dept) q.set('dept', dept);
  return `/?${q.toString()}`;
}
