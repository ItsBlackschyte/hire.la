import type { MetadataRoute } from 'next';
import { supabaseServer } from '@/lib/supabase';
import { CITIES } from '@/lib/cities';

/** Regenerated every 6h, in step with the worker + ISR pages. */
export const revalidate = 21600;

const BASE = 'https://hire.la';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = supabaseServer();

  const entries: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: 'daily', priority: 1 },
    ...CITIES.map((c) => ({
      url: `${BASE}/?city=${c.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.9,
    })),
    { url: `${BASE}/about`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: 'yearly', priority: 0.1 },
  ];

  const { data: companies } = await db
    .from('companies')
    .select('slug')
    .limit(5000);
  for (const c of companies ?? []) {
    entries.push({
      url: `${BASE}/company/${c.slug}`,
      changeFrequency: 'daily',
      priority: 0.7,
    });
  }

  const { data: jobs } = await db
    .from('jobs')
    .select('slug, last_seen_at')
    .eq('is_active', true)
    .limit(20000);
  for (const j of jobs ?? []) {
    entries.push({
      url: `${BASE}/jobs/${j.slug}`,
      lastModified: j.last_seen_at,
      changeFrequency: 'daily',
      priority: 0.8,
    });
  }

  return entries;
}
