/**
 * Slug helpers shared by the seed script, the worker, and the app.
 * Slugs are generated ONCE at insert time and never regenerated,
 * so URLs stay stable even if names or titles are edited later.
 */

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Job slug pattern: company-title-city, e.g. "spacex-software-engineer-hawthorne" */
export function jobSlug(companySlug: string, title: string, city: string): string {
  return slugify(`${companySlug} ${title} ${city}`);
}
