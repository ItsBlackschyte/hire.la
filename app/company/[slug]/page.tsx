import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { timeAgo, workplaceLabel } from '@/lib/format';
import { homeUrl } from '@/lib/urls';
import AdSlot from '@/components/AdSlot';

export const revalidate = 21600;

interface CompanyRecord {
  id: string;
  slug: string;
  name: string;
  website: string | null;
  logo_url: string | null;
  description: string | null;
  locations: Array<{ id: string; city: string; city_slug: string; label: string | null }>;
}

interface JobListItem {
  slug: string;
  title: string;
  department: string | null;
  workplace_type: 'onsite' | 'hybrid' | 'remote' | null;
  posted_at: string | null;
  locations: { city: string } | null;
}

async function getCompany(slug: string) {
  const db = supabaseServer();
  const { data: company } = await db
    .from('companies')
    .select('id, slug, name, website, logo_url, description, locations ( id, city, city_slug, label )')
    .eq('slug', slug)
    .maybeSingle();
  if (!company) return null;

  const { data: jobs } = await db
    .from('jobs')
    .select('slug, title, department, workplace_type, posted_at, locations ( city )')
    .eq('company_id', company.id)
    .eq('is_active', true)
    .order('posted_at', { ascending: false });

  return {
    company: company as unknown as CompanyRecord,
    jobs: (jobs ?? []) as unknown as JobListItem[],
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await getCompany(slug);
  if (!result) return { title: 'Company not found' };
  const { company, jobs } = result;
  const cities = [...new Set(company.locations.map((l) => l.city))].join(', ');
  return {
    title: `${company.name} jobs`,
    description: `${jobs.length} open ${jobs.length === 1 ? 'role' : 'roles'} at ${company.name}${cities ? ` in ${cities}` : ''}. Live listings on hire.la.`,
  };
}

export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getCompany(slug);
  if (!result) notFound();
  const { company, jobs } = result;

  const citySlug = company.locations[0]?.city_slug ?? 'los-angeles';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: company.name,
    url: company.website ?? `https://hire.la/company/${company.slug}`,
  };

  return (
    <article className="doc">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav className="doc-breadcrumb">
        <Link href={homeUrl(citySlug)}>← Map</Link>
      </nav>

      <header className="doc-header">
        {company.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="doc-logo" src={company.logo_url} alt="" width={56} height={56} />
        )}
        <h1>{company.name}</h1>
        <p className="doc-sub">
          {company.locations.map((l) => l.city).join(' · ')}
          {company.website && (
            <>
              {' · '}
              <a href={company.website} target="_blank" rel="noopener noreferrer">
                website
              </a>
            </>
          )}
        </p>
        {company.description && <p className="doc-desc">{company.description}</p>}
      </header>

      <h2 className="doc-section">
        {jobs.length} open {jobs.length === 1 ? 'role' : 'roles'}
      </h2>

      {jobs.length === 0 ? (
        <p className="doc-body-empty">No open roles right now — check back soon.</p>
      ) : (
        <ul className="doc-job-list">
          {jobs.map((job) => {
            const workplace = workplaceLabel(job.workplace_type);
            const posted = timeAgo(job.posted_at);
            return (
              <li key={job.slug} className="job-row">
                <div className="job-row-main">
                  <p className="job-title">
                    <Link href={`/jobs/${job.slug}`}>{job.title}</Link>
                  </p>
                  <p className="job-meta">
                    {job.department && <span>{job.department}</span>}
                    {job.locations?.city && <span>{job.locations.city}</span>}
                    {workplace && (
                      <span className={`badge badge-${job.workplace_type}`}>{workplace}</span>
                    )}
                    {posted && <span className="job-posted">{posted}</span>}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <AdSlot slot="company-page" />
    </article>
  );
}
