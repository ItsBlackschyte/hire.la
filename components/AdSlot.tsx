'use client';

import { useEffect, useRef } from 'react';

/**
 * Dormant ad slot. Renders NOTHING until NEXT_PUBLIC_ADSENSE_ID is set
 * (e.g. "ca-pub-1234567890"), so it ships from day one and enabling ads
 * after AdSense approval is a Vercel env change — no refactor, no deploy
 * of new code.
 *
 * Loads the AdSense script once per page, then registers this unit.
 */

const CLIENT = process.env.NEXT_PUBLIC_ADSENSE_ID;

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

export default function AdSlot({ slot }: { slot?: string }) {
  const ref = useRef<HTMLModElement>(null);

  useEffect(() => {
    if (!CLIENT || !ref.current) return;

    if (!document.querySelector('script[data-adsense]')) {
      const s = document.createElement('script');
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.setAttribute('data-adsense', '1');
      document.head.appendChild(s);
    }

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Ad blockers throw here; the page must not care.
    }
  }, []);

  if (!CLIENT) return null;

  return (
    <ins
      ref={ref}
      className="adsbygoogle ad-slot"
      style={{ display: 'block' }}
      data-ad-client={CLIENT}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
