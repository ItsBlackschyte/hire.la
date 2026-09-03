'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import { initials } from '@/lib/format';
import type { Job, Pin } from '@/lib/types';
import JobRow from './JobRow';

/**
 * The company panel — bottom sheet on mobile, docked side panel on desktop.
 *
 * Jobs are fetched in pages (PAGE_SIZE) with an exact server-side count, so
 * a board like SpaceX's (~2k postings) shows "2,280 open roles" and loads
 * more on demand instead of silently truncating at Supabase's 1000-row cap.
 * The header count comes from the same query as the list, so they can
 * never disagree.
 */

const PAGE_SIZE = 50;

type PanelJob = Pick<
  Job,
  'id' | 'slug' | 'title' | 'department' | 'workplace_type' | 'apply_url' | 'posted_at'
>;

interface Props {
  pin: Pin | null;
  category: string | null;
  onClose: () => void;
}

export default function CompanyPanel({ pin, category, onClose }: Props) {
  const [jobs, setJobs] = useState<PanelJob[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  function buildQuery(locationId: string, from: number, to: number) {
    let q = supabaseBrowser()
      .from('jobs')
      .select('id, slug, title, department, workplace_type, apply_url, posted_at', { count: 'exact' })
      .eq('location_id', locationId)
      .eq('is_active', true)
      .order('posted_at', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, to);
    if (category) q = q.eq('category', category);
    return q;
  }

  // First page whenever the pin or filter changes.
  useEffect(() => {
    if (!pin) return;
    let cancelled = false;
    setStatus('loading');
    setJobs([]);
    setTotal(null);

    buildQuery(pin.location_id, 0, PAGE_SIZE - 1).then(({ data, error, count }) => {
      if (cancelled) return;
      if (error) {
        setStatus('error');
        return;
      }
      setJobs((data ?? []) as PanelJob[]);
      setTotal(count ?? (data?.length ?? 0));
      setStatus('ready');
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, category, retryKey]);

  async function loadMore() {
    if (!pin || loadingMore) return;
    setLoadingMore(true);
    const { data, error } = await buildQuery(pin.location_id, jobs.length, jobs.length + PAGE_SIZE - 1);
    if (!error && data) setJobs((prev) => [...prev, ...(data as PanelJob[])]);
    setLoadingMore(false);
  }

  if (!pin) return null;

  const remaining = total !== null ? total - jobs.length : 0;

  return (
    <aside className="panel" aria-label={`${pin.company_name} jobs`}>
      <div className="panel-handle" aria-hidden="true" />

      <header className="panel-header">
        <div className="avatar" aria-hidden="true">
          {pin.logo_url ? <img src={pin.logo_url} alt="" /> : initials(pin.company_name)}
        </div>
        <div className="panel-title">
          <h2>{pin.company_name}</h2>
          <p>
            {status === 'ready' && total !== null
              ? `${total.toLocaleString()} open ${total === 1 ? 'role' : 'roles'}${category ? ` · ${category}` : ''}`
              : status === 'loading'
                ? 'Loading roles…'
                : 'Open roles'}
          </p>
        </div>
        {pin.precision === 'city' && (
          <span className="approx-note" title="Exact office address not published — pinned near the city center">
            ≈ city
          </span>
        )}
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
          {category ? `No ${category} roles here right now.` : 'No open roles right now — check back soon.'}
        </div>
      )}

      {status === 'ready' && jobs.length > 0 && (
        <ul className="job-list">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
          {remaining > 0 && (
            <li className="load-more">
              <button className="chip" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Show ${Math.min(remaining, PAGE_SIZE)} more (${remaining.toLocaleString()} left)`}
              </button>
            </li>
          )}
        </ul>
      )}
    </aside>
  );
}
