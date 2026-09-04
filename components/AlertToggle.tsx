'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';
import { signInWithGoogle, useUser } from '@/lib/auth';
import { cityBySlug } from '@/lib/cities';
import { useCities } from '@/lib/useCities';

/**
 * "Email me new {role} jobs in {city}" — a job alert the user explicitly asks
 * for (no marketing). Stores the subscription; sending comes later.
 */
export default function AlertToggle() {
  const params = useSearchParams();
  const cities = useCities();
  const city = cityBySlug(cities, params.get('city'));
  const cat = params.get('cat');
  const user = useUser();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) { setOn(false); return; }
    let q = supabaseBrowser().from('job_alerts').select('id').eq('user_id', user.id).eq('city_slug', city.slug);
    q = cat ? q.eq('category', cat) : q.is('category', null);
    q.maybeSingle().then(({ data }) => setOn(!!data));
  }, [user, city.slug, cat]);

  async function change(next: boolean) {
    if (!user) { await signInWithGoogle(); return; }
    setBusy(true);
    const sb = supabaseBrowser();
    if (next) {
      const { error } = await sb.from('job_alerts').insert({ user_id: user.id, city_slug: city.slug, category: cat });
      if (!error) setOn(true);
    } else {
      let q = sb.from('job_alerts').delete().eq('user_id', user.id).eq('city_slug', city.slug);
      q = cat ? q.eq('category', cat) : q.is('category', null);
      const { error } = await q;
      if (!error) setOn(false);
    }
    setBusy(false);
  }

  const label = `Email me new ${cat ? `${cat} ` : ''}jobs in ${city.city}`;

  return (
    <label className={`alert-toggle${on ? ' on' : ''}`}>
      <input type="checkbox" checked={on} disabled={busy || user === undefined} onChange={(e) => change(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
