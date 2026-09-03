import type { Metadata } from 'next';
import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'About',
  description:
    'hire.la puts tech jobs on a map. Listings come straight from company career portals and refresh twice a day.',
};

export default function AboutPage() {
  return (
    <article className="doc">
      <nav className="doc-breadcrumb">
        <Link href="/">← Map</Link>
      </nav>
      <header className="doc-header">
        <h1>About hire.la</h1>
      </header>
      <div className="doc-body">
        <p>
          hire.la puts tech jobs on a map. Instead of scrolling an endless list, you
          see companies pinned where their offices actually are — tap a pin, see the
          live openings, and apply directly on the company&apos;s own careers site.
        </p>
        <h2>Where the jobs come from</h2>
        <p>
          Listings are pulled straight from each company&apos;s official careers
          portal (the applicant-tracking systems they publish on, such as Greenhouse,
          Lever, and Ashby) and refreshed twice a day. We never rewrite listings and
          we never sit between you and the employer: every application happens on the
          company&apos;s own site. When a position closes at the source, it leaves the
          map on the next refresh.
        </p>
        <h2>Coverage</h2>
        <p>
          We started with the Los Angeles metro — from Santa Monica to Long Beach to
          Glendale — and we&apos;re expanding city by city. If a company you expect to
          see is missing, it usually means their careers portal isn&apos;t on a system
          we ingest yet.
        </p>
        <h2>Contact</h2>
        <p>
          Feedback, corrections, or a company to add:{' '}
          <a href="mailto:hello@hire.la">hello@hire.la</a>.
        </p>
      </div>
      <SiteFooter />
    </article>
  );
}
