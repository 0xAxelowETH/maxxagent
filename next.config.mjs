/** @type {import('next').NextConfig} */

// Security headers. Framing is blocked to prevent clickjacking of wallet prompts.
// NOTE: if MAXXAGENT is later embedded as a Base App mini app, relax frame-ancestors for that host only.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
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
