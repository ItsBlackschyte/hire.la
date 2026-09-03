import Link from 'next/link';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link href="/">Map</Link>
      <Link href="/about">About</Link>
      <Link href="/privacy">Privacy</Link>
      <span className="site-footer-note">
        Listings belong to the hiring companies. Updated twice daily.
      </span>
    </footer>
  );
}
