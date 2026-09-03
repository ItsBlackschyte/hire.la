import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { cleanJobHtml, textExcerpt } from '@/lib/sanitize';
import { timeAgo, workplaceLabel } from '@/lib/format';
import { CITIES } from '@/lib/cities';
import { homeUrl } from '@/lib/urls';
import AdSlot from '@/components/AdSlot';

/** ISR: built on first request, re-rendered in the background every 6h. */
export const revalidate = 21600;

interface JobRecord {
  id: string;
  slug: string;
  title: string;
  department: string | null;
  employment_type: string | null;
  workplace_type: 'onsite' | 'hybrid' | 'remote' | null;
  apply_url: string;
  description_html: string | null;
  posted_at: string | null;
  last_seen_at: string;
  is_active: boolean;
  companies: { name: string; slug: string; website: string | null } | null;
  locations: { city: string; address: string | null; city_slug: string } | null;
}

async function getJob(slug: string): Promise<JobRecord | null> {
  const { data } = await supabaseServer()
    .from('jobs')
    .select(
      'id, slug, title, department, employment_type, workplace_type, apply_url, description_html, posted_at, last_seen_at, is_active, companies ( name, slug, website ), locations ( city, address, city_slug )',
    )
    .eq('slug', slug)
    .maybeSingle();
  return (data as unknown as JobRecord) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJob(slug);
  if (!job || !job.companies) return { title: 'Job not found' };

  const city = job.locations?.city ?? 'Los Angeles';
  const title = `${job.title} at ${job.companies.name} (${city})`;
  const description = job.description_html
    ? textExcerpt(job.description_html)
    : `${job.title} role at ${job.companies.name} in ${city}. See details and apply on hire.la.`;

  return {
    title,
    description,
    openGraph: { title, description, type: 'article' },
  };
}

export default async function JobPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = await getJob(slug);
  if (!job || !job.companies) notFound();

  const company = job.companies;
  const city = job.locations?.city ?? 'Los Angeles';
  const citySlug = job.locations?.city_slug ?? 'los-angeles';
  const country = CITIES.find((c) => c.slug === citySlug)?.country ?? 'United States';
  const workplace = workplaceLabel(job.workplace_type);
  const posted = timeAgo(job.posted_at);
  const description = job.description_html ? cleanJobHtml(job.description_html) : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    datePosted: job.posted_at ?? undefined,
    ...(job.is_active ? {} : { validThrough: job.last_seen_at }),
    description: job.description_html ? textExcerpt(job.description_html, 500) : job.title,
    employmentType: job.employment_type ?? undefined,
    hiringOrganization: {
      '@type': 'Organization',
      name: company.name,
      sameAs: company.website ?? undefined,
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: city,
        streetAddress: job.locations?.address ?? undefined,
        addressCountry: country,
      },
    },
    ...(job.workplace_type === 'remote' ? { jobLocationType: 'TELECOMMUTE' } : {}),
    directApply: false,
    url: `https://hire.la/jobs/${job.slug}`,
  };

  return (
    <article className="doc">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav className="doc-breadcrumb">
        <Link href={homeUrl(citySlug)}>← Map</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/company/${company.slug}`}>{company.name}</Link>
      </nav>

      {!job.is_active && (
        <div className="closed-banner" role="status">
          This position has closed.{' '}
          <Link href={`/company/${company.slug}`}>See {company.name}&apos;s open roles</Link>
        </div>
      )}

      <header className="doc-header">
        <h1>{job.title}</h1>
        <p className="doc-sub">
          <Link href={`/company/${company.slug}`}>{company.name}</Link> · {city}
        </p>
        <p className="doc-badges">
          {job.department && <span className="badge">{job.department}</span>}
          {workplace && <span className={`badge badge-${job.workplace_type}`}>{workplace}</span>}
          {job.employment_type && <span className="badge">{job.employment_type}</span>}
          {posted && <span className="job-posted">posted {posted}</span>}
        </p>
        {job.is_active && (
          <a className="apply-cta" href={job.apply_url} target="_blank" rel="noopener noreferrer">
            Apply at {company.name}
          </a>
        )}
      </header>

      {description ? (
        <div className="doc-body" dangerouslySetInnerHTML={{ __html: description }} />
      ) : (
        <p className="doc-body-empty">
          Full description is on the company&apos;s application page.
        </p>
      )}

      <AdSlot slot="job-page" />

      {job.is_active && (
        <footer className="doc-footer">
          <a className="apply-cta" href={job.apply_url} target="_blank" rel="noopener noreferrer">
            Apply at {company.name}
          </a>
        </footer>
      )}
    </article>
  );
}
