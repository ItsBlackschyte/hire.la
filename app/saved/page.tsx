import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseUser } from '@/lib/supabase-server';
import { timeAgo, workplaceLabel } from '@/lib/format';
import SaveButton from '@/components/SaveButton';
import SiteFooter from '@/components/SiteFooter';

export const metadata: Metadata = { title: 'Saved jobs', robots: { index: false } };
export const dynamic = 'force-dynamic';

interface SavedRow {
  saved_at: string;
  jobs: {
    id: string; slug: string; title: string; department: string | null; category: string | null;
    workplace_type: 'onsite' | 'hybrid' | 'remote' | null; posted_at: string | null; is_active: boolean; apply_url: string;
    companies: { name: string; slug: string; logo_url: string | null } | null;
    locations: { city: string } | null;
  } | null;
}

export default async function SavedPage() {
  const supabase = await supabaseUser();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/?signin=1');

  const { data } = await supabase
    .from('saved_jobs')
    .select('saved_at, jobs ( id, slug, title, department, category, workplace_type, posted_at, is_active, apply_url, companies ( name, slug, logo_url ), locations ( city ) )')
    .eq('user_id', user.id)
    .order('saved_at', { ascending: false });

  const rows = ((data ?? []) as unknown as SavedRow[]).filter((r) => r.jobs);

  return (
    <article className="doc">
      <nav className="doc-breadcrumb"><Link href="/">← Map</Link></nav>
      <header className="doc-header">
        <h1>Saved jobs</h1>
        <p className="doc-sub">{rows.length} {rows.length === 1 ? 'job' : 'jobs'}</p>
      </header>

      {rows.length === 0 ? (
        <p className="doc-body-empty">Nothing saved yet. Tap the bookmark on any job to keep it here.</p>
      ) : (
        <ul className="doc-job-list">
          {rows.map(({ jobs: job }) => job && (
            <li key={job.id} className={`job-row${job.is_active ? '' : ' job-closed'}`}>
              <div className="job-row-main">
                <p className="job-title"><Link href={`/jobs/${job.slug}`}>{job.title}</Link>{!job.is_active && <span className="badge"> closed</span>}</p>
                <p className="job-meta">
                  {job.companies && <Link href={`/company/${job.companies.slug}`}>{job.companies.name}</Link>}
                  {job.locations?.city && <span>{job.locations.city}</span>}
                  {job.category && <span>{job.category}</span>}
                  {workplaceLabel(job.workplace_type) && <span className={`badge badge-${job.workplace_type}`}>{workplaceLabel(job.workplace_type)}</span>}
                  {timeAgo(job.posted_at) && <span className="job-posted">{timeAgo(job.posted_at)}</span>}
                </p>
              </div>
              <SaveButton jobId={job.id} />
              {job.is_active && <a className="apply-link" href={job.apply_url} target="_blank" rel="noopener noreferrer">Apply</a>}
            </li>
          ))}
        </ul>
      )}
      <SiteFooter />
    </article>
  );
}
