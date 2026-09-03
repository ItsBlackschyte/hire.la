import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Anon-key clients only. RLS makes these read-only: public select on
 * companies/locations, and on jobs only where is_active. All writes happen
 * in scripts/ and worker/ with the service-role key, which never enters
 * this module or the browser bundle.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} — copy .env.example to .env.local and fill it in.`);
  return v;
}

let browserClient: SupabaseClient | undefined;

/** Client for 'use client' components. Reused across renders. */
export function supabaseBrowser(): SupabaseClient {
  browserClient ??= createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false } },
  );
  return browserClient;
}

/** Client for server components and route handlers. Cheap to create per request. */
export function supabaseServer(): SupabaseClient {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false } },
  );
}
