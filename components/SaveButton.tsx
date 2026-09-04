'use client';

import { signInWithGoogle } from '@/lib/auth';
import { useSavedJobs } from '@/lib/useSavedJobs';

/** Bookmark toggle. Signed out → starts Google sign-in and returns here. */
export default function SaveButton({ jobId, size = 'sm' }: { jobId: string; size?: 'sm' | 'lg' }) {
  const { user, saved, toggle } = useSavedJobs();
  const on = saved.has(jobId);

  async function onClick() {
    if (user === undefined) return;
    if (!user) { await signInWithGoogle(); return; }
    await toggle(jobId);
  }

  return (
    <button
      className={`save-btn ${size}${on ? ' on' : ''}`}
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? 'Remove from saved jobs' : 'Save job'}
      title={on ? 'Saved' : user ? 'Save job' : 'Sign in to save'}
    >
      <svg width={size === 'lg' ? 20 : 16} height={size === 'lg' ? 20 : 16} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
      </svg>
      {size === 'lg' && <span>{on ? 'Saved' : 'Save'}</span>}
    </button>
  );
}
