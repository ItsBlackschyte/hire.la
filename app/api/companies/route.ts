import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

/**
 * GET /api/companies?city=los-angeles
 * Companies with active jobs in the city (slug, name, logo, count), most jobs first.
 */
export async function GET(req: NextRequest) {
  const city = { slug: (req.nextUrl.searchParams.get('city') ?? 'los-angeles').toLowerCase().replace(/[^a-z0-9-]/g, '') };
  const { data, error } = await supabaseServer().rpc('companies_for_city', { p_city_slug: city.slug });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const companies = ((data ?? []) as Array<{ slug: string; name: string; logo_url: string | null; jobs: number }>).map((c) => ({
    slug: c.slug,
    name: c.name,
    logo_url: c.logo_url,
    jobs: Number(c.jobs),
  }));

  return NextResponse.json(
    { city: city.slug, companies },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
