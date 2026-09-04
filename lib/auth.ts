'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabase';

/** Current user on the client: undefined while loading, null when signed out. */
export function useUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  return user;
}

/** Start Google sign-in; returns to the current page (or `next`) afterwards. */
export async function signInWithGoogle(next?: string) {
  const back = next ?? `${window.location.pathname}${window.location.search}`;
  await supabaseBrowser().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(back)}` },
  });
}

export async function signOut() {
  await supabaseBrowser().auth.signOut();
  window.location.reload();
}

export function displayName(user: User): string {
  const m = user.user_metadata ?? {};
  return (m.full_name as string) || (m.name as string) || user.email?.split('@')[0] || 'You';
}

export function avatarUrl(user: User): string | null {
  const m = user.user_metadata ?? {};
  return (m.avatar_url as string) || (m.picture as string) || null;
}
