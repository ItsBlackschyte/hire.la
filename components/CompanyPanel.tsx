'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import { initials } from '@/lib/format';
import type { Job, Pin } from '@/lib/types';
import JobRow from './JobRow';

/**
 * The company panel — bottom sheet on mobile, docked side panel on desktop
 * (pure CSS breakpoint, same component). Fetches the selected office's
 * active jobs directly through the anon Supabase client; RLS guarantees
 * this can only ever read active rows.
 */

type PanelJob = Pick<
  Job,
  'id' | 'slug' | 'title' | 'department' | 'workplace_type' | 'apply_url' | 'posted_at'
>;

interface Props {
  pin: Pin | null;
  dept: string | null;
  onClose: () => void;
}

export default function CompanyPanel({ pin, dept, onClose }: Props) {
  const [jobs, setJobs] = useState<PanelJob[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!pin) return;
    let cancelled = false;
    setStatus('loading');

    let query = supabaseBrowser()
      .from('jobs')
      .select('id, slug, title, department, workplace_type, apply_url, posted_at')
      .eq('location_id', pin.location_id)
      .eq('is_active', true)
      .order('posted_at', { ascending: false });
    if (dept) query = query.eq('department', dept);

    query.then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setStatus('error');
        } else {
          setJobs((data ?? []) as PanelJob[]);
          setStatus('ready');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pin, dept, retryKey]);

  if (!pin) return null;

  return (
    <aside className="panel" aria-label={`${pin.company_name} jobs`}>
      <div className="panel-handle" aria-hidden="true" />

      <header className="panel-header">
        <div className="avatar" aria-hidden="true">{initials(pin.company_name)}</div>
        <div className="panel-title">
          <h2>{pin.company_name}</h2>
          <p>
            {pin.open_jobs} open {pin.open_jobs === 1 ? 'role' : 'roles'}
          </p>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>

      {status === 'loading' && (
        <ul className="job-list" aria-hidden="true">
          <li className="job-skeleton" />
          <li className="job-skeleton" />
          <li className="job-skeleton" />
        </ul>
      )}

      {status === 'error' && (
        <div className="panel-note">
          Couldn&apos;t load jobs.{' '}
          <button className="link-button" onClick={() => setRetryKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}

      {status === 'ready' && jobs.length === 0 && (
        <div className="panel-note">
          {dept ? `No ${dept} roles here right now.` : 'No open roles right now — check back soon.'}
        </div>
      )}

      {status === 'ready' && jobs.length > 0 && (
        <ul className="job-list">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </ul>
      )}
    </aside>
  );
}
