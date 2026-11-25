/** @type {import('next').NextConfig} */

// Security headers. Framing is limited to mini app hosts (Farcaster web, Base App) to prevent clickjacking
// of wallet prompts everywhere else. X-Frame-Options can't express an allowlist, so CSP frame-ancestors is the
// control (supported by every current browser); native mini app WebViews don't frame the page at all.
const FRAME_HOSTS = "https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com https://base.app https://*.base.app https://base.dev https://*.base.dev";
const SCRIPT_SRC =
  process.env.NODE_ENV === "development"
    ? "'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com"
    : "'self' 'unsafe-inline' https://va.vercel-scripts.com";
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: `default-src 'self'; script-src ${SCRIPT_SRC}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.reown.com; connect-src 'self' https: wss:; frame-src 'self' https://verify.walletconnect.org https://verify.walletconnect.com https://secure.walletconnect.org https://keys.coinbase.com; frame-ancestors 'self' ${FRAME_HOSTS}; base-uri 'self'; form-action 'self'; object-src 'none'`,
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
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
  // Share cards read their TTF fonts and logo from assets/og at runtime; ship them with those functions
  outputFileTracingIncludes: { "/api/og/**": ["./assets/og/**", "./public/logos/stocks/**"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Short links to each tab of the app (for posts and reviewers): /agent opens the Agent tab, etc.
  async redirects() {
    return ["market", "agent", "indexes", "news", "portfolio"].map((tab) => ({
      source: `/${tab}`,
      destination: tab === "market" ? "/" : `/?tab=${tab}`,
      permanent: false,
    }));
  },
  // Mobile DApp browsers (OKX, Bitget, Binance, Zerion) probe /favicon.ico when bookmarking or listing history
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/brand/maxxagent-mark-512.png" }];
  },
};

export default nextConfig;
