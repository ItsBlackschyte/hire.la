'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase';
import { useUser } from './auth';

/** The signed-in user's saved job ids, with optimistic toggle. */
export function useSavedJobs() {
  const user = useUser();
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) { setIds(new Set()); return; }
    let cancelled = false;
    supabaseBrowser()
      .from('saved_jobs')
      .select('job_id')
      .eq('user_id', user.id)
      .limit(2000)
      .then(({ data }) => {
        if (!cancelled) setIds(new Set((data ?? []).map((r) => r.job_id as string)));
      });
    return () => { cancelled = true; };
  }, [user]);

  const toggle = useCallback(async (jobId: string) => {
    if (!user) return false;
    const sb = supabaseBrowser();
    const has = ids.has(jobId);
    setIds((prev) => { const n = new Set(prev); if (has) n.delete(jobId); else n.add(jobId); return n; });
    const { error } = has
      ? await sb.from('saved_jobs').delete().eq('user_id', user.id).eq('job_id', jobId)
      : await sb.from('saved_jobs').insert({ user_id: user.id, job_id: jobId });
    if (error) setIds((prev) => { const n = new Set(prev); if (has) n.add(jobId); else n.delete(jobId); return n; });
    return true;
  }, [user, ids]);

  return { user, saved: ids, toggle };
}
