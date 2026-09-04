import type { Metadata } from 'next';
import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'The terms for using hire.la.',
};

export default function TermsPage() {
  return (
    <article className="doc">
      <nav className="doc-breadcrumb">
        <Link href="/">← Map</Link>
      </nav>
      <header className="doc-header">
        <h1>Terms of use</h1>
        <p className="doc-sub">Effective September 2026</p>
      </header>
      <div className="doc-body">
        <p>
          By using hire.la you agree to these terms. If you don&apos;t agree, please don&apos;t use the site.
        </p>

        <h2>What hire.la is</h2>
        <p>
          hire.la shows job openings published by companies on their own careers sites, placed on a map. We are
          not the employer and we are not a recruiter: every application happens on the hiring company&apos;s own
          site, under that company&apos;s terms. Listings, job details, and company names and logos belong to the
          companies that publish them; logos are shown only to identify the company.
        </p>

        <h2>Accuracy</h2>
        <p>
          Listings refresh from company careers sites twice a day, so a role may have closed before we catch up.
          Pin locations are the company&apos;s office where we know it; otherwise a placeholder near the city
          center, marked as approximate. We do our best, but we can&apos;t guarantee that any listing, location,
          or count is complete or current.
        </p>

        <h2>Accounts</h2>
        <p>
          You can browse without an account. If you sign in — with Google or LinkedIn — we store the email
          address and name your provider shares with us. We use them to run your account and to deliver the
          features you turn on, such as saved jobs and job alerts. We don&apos;t send promotional email unless
          you have explicitly opted in, and any such email will include a one-click unsubscribe.
        </p>

        <h2>Job alerts</h2>
        <p>
          Alerts are opt-in and specific: you choose a city and role, and we email you when matching roles
          appear. You can change or stop alerts at any time from your settings or from the link in any alert
          email.
        </p>

        <h2>Acceptable use</h2>
        <p>
          Don&apos;t scrape, bulk-download, or overload the site, resell its data, or use it to harass anyone.
          We may suspend accounts that abuse the service.
        </p>

        <h2>Liability</h2>
        <p>
          hire.la is provided as-is, free of charge, without warranties of any kind. To the fullest extent the
          law allows, we aren&apos;t liable for losses arising from your use of the site, from any listing, or
          from any decision you make based on it.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these terms; the effective date above will change when we do. Continued use after a
          change means you accept the new terms.
        </p>

        <h2>Contact</h2>
        <p>
          Questions: <a href="mailto:hello@hire.la">hello@hire.la</a>. See also our{' '}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </div>
      <SiteFooter />
    </article>
  );
}
