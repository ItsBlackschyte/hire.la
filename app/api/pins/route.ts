import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import type { Pin } from '@/lib/types';

/**
 * GET /api/pins?city=los-angeles&cat=Software%20Engineering
 *
 * Returns every office in the city with its company and open-job count.
 * The response is identical for all users until the next worker run, so
 * it is cached at the edge: one DB query serves everyone for 5 minutes.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const city = { slug: (params.get('city') ?? 'los-angeles').toLowerCase().replace(/[^a-z0-9-]/g, '') };
  const cat = params.get('cat');

  const db = supabaseServer();
  const { data, error } = await db.rpc('pins_for_city', {
    p_city_slug: city.slug,
    p_category: cat || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pins = (data ?? []) as Pin[];

  return NextResponse.json(
    { city: city.slug, count: pins.length, pins },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    },
  );
}
