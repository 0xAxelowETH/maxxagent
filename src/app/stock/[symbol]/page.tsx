import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileText } from "lucide-react";
import { SiteNav } from "@/components/SiteNav";
import { StockLive } from "@/components/StockLive";
import { NewsFeed } from "@/components/NewsFeed";
import { PairedForStock } from "@/components/PairedForStock";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { miniappEmbedTags } from "@/lib/miniappEmbed";

const find = (symbol: string) => BASE_TOKENIZED_STOCKS.find((s) => s.symbol.toLowerCase() === symbol.toLowerCase());

export function generateStaticParams() {
  return BASE_TOKENIZED_STOCKS.map((s) => ({ symbol: s.symbol }));
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const s = find((await params).symbol);
  if (!s) return { title: "Stock not found — MAXXAGENT" };
  const title = `${s.symbol} (${s.companyName}) tokenized stock on Base — MAXXAGENT`;
  const description = `Live Chainlink NAV, Base DEX price and liquidity for ${s.symbol}, Coinbase's tokenized ${s.companyName} stock on Base. Buy or sell from your own wallet. Not financial advice.`;
  const image = `/api/og/stock?symbol=${s.symbol}`;
  return {
    title,
    description,
    alternates: { canonical: `/stock/${s.symbol}` },
    openGraph: { type: "website", siteName: "MAXXAGENT", title, description, images: [{ url: image, width: 1200, height: 630, alt: `${s.symbol}: live price and 7-day chart` }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    // Shared in Farcaster, the card launches the mini app straight on this stock
    other: miniappEmbedTags({
      siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, ""),
      path: `/stock/${s.symbol}`,
      buttonTitle: `Trade ${s.symbol}`,
    }),
  };
}

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const s = find((await params).symbol);
  if (!s) notFound();
  const facts: [string, React.ReactNode][] = [
    ["Underlying", `${s.companyName} (${s.tickerUnderlying})`],
    ["Sector", s.sector],
    ["ISIN", s.isin],
    [
      "Token (B20)",
      <a key="t" href={s.basescanUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-cyan-300 hover:underline break-all">
        {s.b20Address}
      </a>,
    ],
    [
      "Chainlink NAV feed",
      <a
        key="f"
        href={`https://basescan.org/address/${s.chainlinkFeed}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-cyan-300 hover:underline break-all"
      >
        {s.chainlinkFeed}
      </a>,
    ],
    ["Decimals", String(s.decimals)],
    ["Issuer", "Coinbase (B20 tokenized stock)"],
  ];

  const peers = BASE_TOKENIZED_STOCKS.filter((p) => p.sector === s.sector && p.symbol !== s.symbol);

  return (
    <main className="min-h-screen bg-[#02050c] bg-cyber-grid px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <SiteNav />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img src={s.logoUrl} alt="" className="h-14 w-14 rounded-2xl bg-white/5 object-contain p-1.5" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-extrabold text-white">{s.symbol}</h1>
                <span className="rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-[11px] font-semibold text-slate-300">
                  {s.sector}
                </span>
              </div>
              <p className="text-sm text-slate-400">
                {s.name} · tracks {s.companyName} ({s.tickerUnderlying})
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/?stock=${s.symbol}`}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-gradient-to-r from-[#4C6FFF] to-cyan-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#4C6FFF]/25 hover:brightness-110"
            >
              Buy or sell {s.symbol}
            </Link>
            <Link
              href={`/?tab=agent&prompt=${encodeURIComponent(`Build a basket around ${s.symbol} (${s.sector}), max 30% per stock`)}`}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-700 bg-[#0b1120] px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-cyan-400/50 hover:text-white"
            >
              Ask Agent with {s.symbol}
            </Link>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-slate-300">{s.description}</p>

        <StockLive symbol={s.symbol} color={s.color} />

        <PairedForStock symbol={s.symbol} />

        {peers.length > 0 && (
          <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4">
            <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-400">Same sector peers ({s.sector})</h2>
            <div className="flex flex-wrap gap-2">
              {peers.map((p) => (
                <Link
                  key={p.symbol}
                  href={`/stock/${p.symbol}`}
                  className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-slate-800 bg-[#060b16] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#4C6FFF]/60 hover:text-white transition"
                >
                  <img src={p.logoUrl} alt="" className="h-5 w-5 rounded-full object-contain" />
                  <span className="font-mono font-bold text-white">{p.symbol}</span>
                  <span className="text-slate-400">{p.companyName}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <NewsFeed symbol={s.symbol} limit={10} />

        <div className="flex flex-wrap gap-2">
          <a
            href={s.prospectusUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:border-slate-500"
          >
            <FileText className="h-4 w-4" /> Prospectus
          </a>
          <a
            href={s.basescanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:border-slate-500"
          >
            <ExternalLink className="h-4 w-4" /> BaseScan
          </a>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4">
          <h2 className="mb-3 text-sm font-bold text-white">Token details</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-[auto_1fr]">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-slate-200">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-[11px] leading-relaxed text-slate-500">
          A tokenized stock is not the share itself and gives no shareholder rights beyond what the token provides. Prices
          can differ from the stock, especially when US markets are closed. Not financial advice. Eligible non-US persons
          only: see the{" "}
          <Link href="/terms" className="underline hover:text-slate-300">
            Terms &amp; Risk Disclosure
          </Link>{" "}
          and{" "}
          <Link href="/faq" className="underline hover:text-slate-300">
            FAQ
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
