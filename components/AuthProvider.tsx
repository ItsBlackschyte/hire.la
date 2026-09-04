'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase';

/**
 * Accounts, minimal by design:
 *   - Browse freely. Sign-in is asked for at the moment of intent: Apply.
 *   - OAuth only (Google, LinkedIn). No passwords, no emails.
 *   - Signed-in users get one thing today: we remember which jobs they've
 *     visited (the greyed Apply button). Alerts/saves build on this later.
 *
 * Apply while signed out → the intent is parked in sessionStorage, the
 * sign-in sheet opens, OAuth redirects and returns to the same URL, and a
 * "continue to application" bar completes the click (browsers block new
 * tabs after a redirect, so it needs one more tap).
 */

export type Provider = 'google' | 'linkedin_oidc';

export interface ApplyIntent {
  jobId: string;
  applyUrl: string;
  title: string;
  company: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  visited: Set<string>;
  isVisited: (jobId: string) => boolean;
  markVisited: (jobId: string) => void;
  signIn: (provider: Provider) => Promise<void>;
  signOut: () => Promise<void>;
  requestApply: (intent: ApplyIntent) => void;
  openSignIn: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const INTENT_KEY = 'hire-la:apply-intent';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, setPending] = useState<ApplyIntent | null>(null);

  // Session
  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Visited jobs for this user
  useEffect(() => {
    if (!user) {
      setVisited(new Set());
      return;
    }
    let cancelled = false;
    supabaseBrowser()
      .from('job_visits')
      .select('job_id')
      .then(({ data }) => {
        if (!cancelled) setVisited(new Set((data ?? []).map((r) => r.job_id as string)));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Resume a parked Apply once signed in
  useEffect(() => {
    if (!user) return;
    try {
      const raw = window.sessionStorage.getItem(INTENT_KEY);
      if (raw) {
        setPending(JSON.parse(raw) as ApplyIntent);
        setSheetOpen(false);
      }
    } catch {
      /* ignore */
    }
  }, [user]);

  const markVisited = useCallback((jobId: string) => {
    setVisited((prev) => new Set(prev).add(jobId));
    supabaseBrowser().rpc('mark_job_visited', { p_job_id: jobId }).then(() => undefined, () => undefined);
  }, []);

  const signIn = useCallback(async (provider: Provider) => {
    const next = window.location.pathname + window.location.search;
    await supabaseBrowser().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  }, []);

  const signOut = useCallback(async () => {
    await supabaseBrowser().auth.signOut();
    setUser(null);
  }, []);

  const requestApply = useCallback((intent: ApplyIntent) => {
    try {
      window.sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
    } catch {
      /* ignore */
    }
    setSheetOpen(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      visited,
      isVisited: (id) => visited.has(id),
      markVisited,
      signIn,
      signOut,
      requestApply,
      openSignIn: () => setSheetOpen(true),
    }),
    [user, loading, visited, markVisited, signIn, signOut, requestApply],
  );

  function continueApply() {
    if (!pending) return;
    window.open(pending.applyUrl, '_blank', 'noopener,noreferrer');
    markVisited(pending.jobId);
    clearPending();
  }

  function clearPending() {
    setPending(null);
    try {
      window.sessionStorage.removeItem(INTENT_KEY);
    } catch {
      /* ignore */
    }
  }

  return (
    <AuthContext.Provider value={value}>
      {children}

      {sheetOpen && (
        <div className="sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="signin-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="signin-title">Sign in to apply</h2>
            <p className="sheet-text">
              Browsing is free. Signing in lets us remember which jobs you&apos;ve visited, and soon: job alerts for your
              city and role. No passwords, no newsletters.
            </p>
            <button className="oauth-btn" onClick={() => signIn('google')}>
              <span className="oauth-mark">G</span> Continue with Google
            </button>
            <button className="oauth-btn" onClick={() => signIn('linkedin_oidc')}>
              <span className="oauth-mark">in</span> Continue with LinkedIn
            </button>
            <button className="link-button sheet-cancel" onClick={() => setSheetOpen(false)}>
              Not now
            </button>
          </div>
        </div>
      )}

      {pending && user && (
        <div className="toast" role="status">
          <span>
            Signed in. Continue to <strong>{pending.company}</strong> — {pending.title}
          </span>
          <button className="toast-cta" onClick={continueApply}>
            Open application
          </button>
          <button className="toast-dismiss" onClick={clearPending} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
