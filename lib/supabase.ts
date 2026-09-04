import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

/**
 * - supabaseBrowser(): the user's client. Cookie-backed session (via
 *   @supabase/ssr) so sign-in state survives reloads and is visible to
 *   server code. RLS decides what it may read/write.
 * - supabaseServer(): stateless anon client for public reads in route
 *   handlers and ISR pages (no user context; cache-friendly).
 *
 * NEXT_PUBLIC_* vars must be referenced by literal name — Next inlines them
 * into the browser bundle by string replacement.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing env var ${name} — copy .env.example to .env.local, fill it in, and restart the dev server.`);
  }
  return value;
}

let browserClient: SupabaseClient | undefined;

export function supabaseBrowser(): SupabaseClient {
  browserClient ??= createBrowserClient(
    required('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY', SUPABASE_ANON_KEY),
  );
  return browserClient;
}

export function supabaseServer(): SupabaseClient {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY', SUPABASE_ANON_KEY),
    { auth: { persistSession: false } },
  );
}
