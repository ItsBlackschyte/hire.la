/** URL builders — the URL is the app's single source of truth for city + filter. */

export function homeUrl(citySlug: string, cat?: string | null): string {
  const q = new URLSearchParams({ city: citySlug });
  if (cat) q.set('cat', cat);
  return `/?${q.toString()}`;
}
