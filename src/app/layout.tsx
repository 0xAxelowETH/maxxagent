import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { MiniAppReady } from "@/components/MiniAppReady";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600", "700"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const DESCRIPTION =
  "Build your own index of Coinbase tokenized stocks on Base, or let an agent propose one, and buy it in one click from your own wallet. Live Chainlink NAV vs DEX prices, non-custodial. Not financial advice.";

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
    images: [{ url: "/brand/maxxagent-og.png", width: 1200, height: 630, alt: "MAXXAGENT" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MAXXAGENT — Tokenized stock baskets on Base",
    description: DESCRIPTION,
    images: ["/brand/maxxagent-og.png"],
  },
  // Mini app embed: a shared link renders as a 3:2 card with a launch button in Farcaster clients
  other: (() => {
    const base = SITE_URL.replace(/\/$/, "");
    const embed = (type: string) =>
      JSON.stringify({
        version: "1",
        imageUrl: `${base}/brand/miniapp-embed-1200x800.png`,
        button: {
          title: "Build a stock index",
          action: {
            type,
            name: "MAXXAGENT",
            url: `${base}/`,
            splashImageUrl: `${base}/brand/miniapp-splash-200.png`,
            splashBackgroundColor: "#03060e",
          },
        },
      });
    return { "fc:miniapp": embed("launch_miniapp"), "fc:frame": embed("launch_frame") };
  })(),
};

export const viewport = {
  themeColor: "#03060e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${jakarta.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-[#03060e] text-slate-100 antialiased selection:bg-[#4C6FFF] selection:text-white">
        {children}
        <MiniAppReady />
        {/* Cookieless page-view analytics (no wallet addresses or personal data are sent) */}
        <Analytics />
      </body>
    </html>
  );
}
