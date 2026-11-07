/** @type {import('next').NextConfig} */

// Security headers. Framing is limited to mini app hosts (Farcaster web, Base App) to prevent clickjacking
// of wallet prompts everywhere else. X-Frame-Options can't express an allowlist, so CSP frame-ancestors is the
// control (supported by every current browser); native mini app WebViews don't frame the page at all.
const FRAME_HOSTS = "https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com https://base.app https://*.base.app";
const securityHeaders = [
  { key: "Content-Security-Policy", value: `frame-ancestors 'self' ${FRAME_HOSTS}; base-uri 'self'; form-action 'self'; object-src 'none'` },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig = {
  reactStrictMode: true,
  // Separate build folder for audits/CI so `next build` never clobbers a running `next dev` (.next)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // Hide the Next.js dev badge (it overlaps the mobile bottom nav in demos)
  devIndicators: false,
  // next/image is not used; no remote image hosts are allowed (avoids an open image proxy)
  images: { remotePatterns: [] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
