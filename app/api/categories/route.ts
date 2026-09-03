import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { categoryOrder } from '@/lib/categorize';

/**
 * GET /api/categories?city=los-angeles
 * Role categories with active-job counts, aggregated in SQL (no row cap).
 */
export async function GET(req: NextRequest) {
  const city = { slug: (req.nextUrl.searchParams.get('city') ?? 'los-angeles').toLowerCase().replace(/[^a-z0-9-]/g, '') };
  const db = supabaseServer();

  const { data, error } = await db.rpc('categories_for_city', { p_city_slug: city.slug });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const categories = ((data ?? []) as Array<{ category: string; jobs: number }>)
    .map((r) => ({ name: r.category, count: Number(r.jobs) }))
    .sort((a, b) => categoryOrder(a.name) - categoryOrder(b.name));

  return NextResponse.json(
    { city: city.slug, categories },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
