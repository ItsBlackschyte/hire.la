import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { required } from './supabase';

/**
 * User-aware Supabase client for server components, route handlers and
 * server actions: reads the session from cookies. Using it makes a route
 * dynamic (no ISR) — use only where the user matters (/saved, /auth, /admin).
 */
export async function supabaseUser() {
  const cookieStore = await cookies();
  return createServerClient(
    required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server components can't write cookies; proxy.ts refreshes the session instead.
          }
        },
      },
    },
  );
}
