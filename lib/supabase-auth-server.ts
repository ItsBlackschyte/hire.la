import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Cookie-aware client for server code that must know WHO the user is
 * (the OAuth callback now; the admin panel later). Server-only.
 */
export async function supabaseServerAuth() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component render: cookies are read-only there. Safe to ignore.
        }
      },
    },
  });
}
