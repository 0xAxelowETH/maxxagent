import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { MaxxAgentLogo } from "@/components/BrandLogo";
import { StockLive } from "@/components/StockLive";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { miniappEmbedTags } from "@/lib/miniappEmbed";

const find = (symbol: string) => BASE_TOKENIZED_STOCKS.find((s) => s.symbol.toLowerCase() === symbol.toLowerCase());

export function generateStaticParams() {
  return BASE_TOKENIZED_STOCKS.map((s) => ({ symbol: s.symbol }));
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const s = find((await params).symbol);
  if (!s) return { title: "Stock not found — MAXXAGENT" };
  return {
    title: `${s.symbol} (${s.companyName}) tokenized stock on Base — MAXXAGENT`,
    description: `Live Chainlink NAV, Base DEX price and liquidity for ${s.symbol}, Coinbase's tokenized ${s.companyName} stock on Base. Buy or sell from your own wallet.`,
    alternates: { canonical: `/stock/${s.symbol}` },
    // Shared in Farcaster, the card launches the mini app straight on this stock
    other: miniappEmbedTags({
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz",
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

  return (
    <main className="min-h-screen bg-[#03060e] px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="inline-block">
            <MaxxAgentLogo size={32} />
          </Link>
          <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> All stocks
          </Link>
        </div>

        <div className="flex items-center gap-4">
          <img src={s.logoUrl} alt="" className="h-14 w-14 rounded-2xl bg-white/5 object-contain p-1.5" />
          <div>
            <h1 className="text-2xl font-extrabold text-white">{s.symbol}</h1>
            <p className="text-sm text-slate-400">
              {s.name} · tracks {s.companyName} ({s.tickerUnderlying})
            </p>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-slate-300">{s.description}</p>

        <StockLive symbol={s.symbol} color={s.color} />

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/?stock=${s.symbol}`}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4C6FFF] px-5 py-3 text-sm font-bold text-white hover:brightness-110"
          >
            Buy or sell {s.symbol}
          </Link>
          <a
            href={s.prospectusUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-200 hover:border-slate-500"
          >
            <FileText className="h-4 w-4" /> Prospectus
          </a>
          <a
            href={s.basescanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-200 hover:border-slate-500"
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
