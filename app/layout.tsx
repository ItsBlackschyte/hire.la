import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://hire.la'),
  title: {
    default: 'hire.la — tech jobs on the map',
    template: '%s — hire.la',
  },
  description:
    'Tech jobs in Los Angeles, pinned where they actually are. Tap a company on the map to see its live openings, filter by department, and apply directly.',
  openGraph: {
    siteName: 'hire.la',
    title: 'hire.la — tech jobs on the map',
    description:
      'Tech jobs in Los Angeles, pinned where they actually are. Tap a company to see live openings.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f4f6f8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
