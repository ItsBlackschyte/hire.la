import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Dev only: lets phones/other devices on your LAN load the dev server
   * (http://<your-ip>:3000). Next 16 blocks its own scripts for origins
   * not listed here, which shows up as a page stuck on "Loading…" with
   * no JavaScript running. Ignored in production builds.
   */
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*', '*.local'],

  /** Hide the floating "N" dev-tools badge; errors still surface in the terminal and console. */
  devIndicators: false,
};

export default nextConfig;
