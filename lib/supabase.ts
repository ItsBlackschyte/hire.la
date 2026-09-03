import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Anon-key clients only. RLS makes these read-only: public select on
 * companies/locations/jobs. All writes happen in scripts/ and worker/ with
 * the service-role key, which never enters this module or the browser.
 *
 * IMPORTANT: NEXT_PUBLIC_* variables must be referenced by their literal
 * name (process.env.NEXT_PUBLIC_X) — Next.js inlines them into the browser
 * bundle at build time by string replacement. A dynamic lookup like
 * process.env[name] is invisible to that step and yields undefined in the
 * browser while working fine on the server.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing env var ${name} — copy .env.example to .env.local, fill it in, and restart the dev server.`,
    );
  }
  return value;
}

let browserClient: SupabaseClient | undefined;

/** Client for 'use client' components. Reused across renders. */
export function supabaseBrowser(): SupabaseClient {
  browserClient ??= createClient(
    required('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY', SUPABASE_ANON_KEY),
    { auth: { persistSession: false } },
  );
  return browserClient;
}

/** Client for server components and route handlers. Cheap to create per request. */
export function supabaseServer(): SupabaseClient {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY', SUPABASE_ANON_KEY),
    { auth: { persistSession: false } },
  );
}
