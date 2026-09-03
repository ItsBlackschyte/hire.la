import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import type { City } from '@/lib/cities';

/**
 * GET /api/cities
 * Every city the selector should offer: seeded cities always, auto-discovered
 * cities once they have active jobs. Grouped by country.
 */
export async function GET() {
  const { data, error } = await supabaseServer().rpc('cities_with_counts');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const cities: City[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    slug: r.slug as string,
    city: r.name as string,
    region: (r.region as string | null) ?? undefined,
    country: r.country as string,
    center: [Number(r.lng), Number(r.lat)] as [number, number],
    zoom: Number(r.zoom),
    jobs: Number(r.jobs),
  }));

  return NextResponse.json(
    { cities },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
