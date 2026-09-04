import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServerAuth } from '@/lib/supabase-auth-server';

/**
 * OAuth return leg. Google/LinkedIn → Supabase → here with ?code=…
 * Exchanges the code for a session (cookies) and sends the user back to
 * where they were (?next=), which restores city/role/company from the URL.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (code) {
    const supabase = await supabaseServerAuth();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
