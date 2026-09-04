import type { Metadata } from 'next';
import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'How hire.la handles data.',
};

export default function PrivacyPage() {
  return (
    <article className="doc">
      <nav className="doc-breadcrumb">
        <Link href="/">← Map</Link>
      </nav>
      <header className="doc-header">
        <h1>Privacy policy</h1>
        <p className="doc-sub">Effective September 2026</p>
      </header>
      <div className="doc-body">
        <p>
          hire.la is a job discovery site. You can use it without creating an account,
          and we aim to collect as little data as possible.
        </p>
        <h2>Browsing without an account</h2>
        <p>
          We don&apos;t ask for your name, email, or any personal details to browse the
          site. Our hosting providers (Vercel and Supabase) keep standard server logs —
          IP address, browser type, pages requested — which we use only to operate the
          service and understand aggregate traffic. Map tiles are served by
          OpenFreeMap, which receives the tile requests your browser makes. Your map
          style preference is stored in your own browser, not on our servers.
        </p>
        <h2>If you sign in</h2>
        <p>
          Signing in uses Google or LinkedIn. We receive and store the email address,
          name, and profile picture your provider shares, plus the things you do on
          hire.la with an account: saved jobs and job-alert subscriptions. We use this
          data to run your account and deliver those features — nothing else. A
          session cookie keeps you signed in. You can delete your account and its data
          at any time by emailing us.
        </p>
        <h2>Email</h2>
        <p>
          We send email only when you ask for it: job alerts you subscribe to, and
          account notices. We don&apos;t send promotional email unless you explicitly
          opt in, and every promotional email carries a one-click unsubscribe. Alert
          email is delivered through a third-party email service acting on our behalf.
        </p>
        <h2>What we don&apos;t do</h2>
        <p>
          We don&apos;t sell personal data, and we don&apos;t track you across other
          websites. Job applications happen entirely on the hiring company&apos;s own
          site under that company&apos;s privacy policy — nothing you type into an
          application form passes through hire.la.
        </p>
        <h2>Advertising and cookies</h2>
        <p>
          If we introduce advertising to keep the site free, ads would be served by a
          third-party network (such as Google AdSense) that may use cookies subject to
          your consent. We&apos;ll update this policy and show a consent notice before
          any such cookies are set.
        </p>
        <h2>Changes and contact</h2>
        <p>
          We&apos;ll post any changes to this policy on this page. Questions or deletion
          requests: <a href="mailto:hello@hire.la">hello@hire.la</a>. See also our{' '}
          <Link href="/terms">terms of use</Link>.
        </p>
      </div>
      <SiteFooter />
    </article>
  );
}
