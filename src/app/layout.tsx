import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { MiniAppReady } from "@/components/MiniAppReady";
import { miniappEmbedTags } from "@/lib/miniappEmbed";
import "./globals.css";

// Self-hosted (SIL Open Font License, see src/app/fonts/OFL-*.txt). The build no longer downloads them from
// Google Fonts, whose responses next/font failed to parse (builds broke with "reading '1'").
// Latin subset, one variable file per family covering all the weights used.
const jakarta = localFont({
  src: [{ path: "./fonts/PlusJakartaSans-latin.woff2", weight: "400 800", style: "normal" }],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: [{ path: "./fonts/JetBrainsMono-latin.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-mono",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz";
const DESCRIPTION =
  "Build your own index of Coinbase tokenized stocks on Base, or let an agent propose one, and buy it in one flow from your own wallet. Live Chainlink NAV vs DEX prices, non-custodial. Not financial advice.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "MAXXAGENT — Tokenized stock baskets on Base",
  description: DESCRIPTION,
  applicationName: "MAXXAGENT",
  openGraph: {
    type: "website",
    siteName: "MAXXAGENT",
    title: "MAXXAGENT — Tokenized stock baskets on Base",
    description: DESCRIPTION,
    // Live card (the 10 stocks with NAV and 24h move), cached for an hour; see /api/og/home
    images: [{ url: "/api/og/home", width: 1200, height: 630, alt: "MAXXAGENT: build your own index of tokenized stocks on Base" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MAXXAGENT — Tokenized stock baskets on Base",
    description: DESCRIPTION,
    images: ["/api/og/home"],
  },
  // Mini app embed: a shared link renders as a 3:2 card with a launch button in Farcaster clients
  other: miniappEmbedTags({ siteUrl: SITE_URL }),
};

export const viewport = {
  themeColor: "#03060e",
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${jakarta.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("maxxagent_theme")==="light"){var r=document.documentElement;r.dataset.theme="light";r.classList.remove("dark");r.classList.add("light");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#f4f7fc");}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-[#03060e] text-slate-100 antialiased selection:bg-[#4C6FFF] selection:text-white">
        {children}
        <MiniAppReady />
        {/* Cookieless page-view analytics on Vercel deployments (avoids 404 MIME errors on local next start) */}
        {Boolean(process.env.VERCEL) && <Analytics />}
      </body>
    </html>
  );
}
