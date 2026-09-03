import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { cityBySlug } from '@/lib/cities';

/**
 * GET /api/departments?city=los-angeles
 * Distinct departments with active jobs in the city — feeds the filter chips.
 * Cached at the edge like /api/pins.
 */
export async function GET(req: NextRequest) {
  const city = cityBySlug(req.nextUrl.searchParams.get('city'));
  const db = supabaseServer();

  const { data, error } = await db
    .from('jobs')
    .select('department, locations!inner(city_slug)')
    .eq('is_active', true)
    .eq('locations.city_slug', city.slug)
    .not('department', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const departments = [...new Set((data ?? []).map((r) => r.department as string))].sort();

  return NextResponse.json(
    { city: city.slug, departments },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
