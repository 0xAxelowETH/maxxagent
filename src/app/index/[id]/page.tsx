import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { SiteNav } from "@/components/SiteNav";
import { IndexBuyBox } from "@/components/IndexBuyBox";
import { REGISTRY, readIndex } from "@/lib/indexRegistry";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { miniappEmbedTags } from "@/lib/miniappEmbed";

export const revalidate = 60;

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz";
const parseId = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : -1);

async function load(idParam: string) {
  try {
    return await readIndex(parseId(idParam));
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const ix = await load((await params).id);
  if (!ix) return { title: "Index not found — MAXXAGENT" };
  const legs = ix.constituents.map((c) => `${c.symbol} ${(c.weightBps / 100).toFixed(0)}%`).join(", ");
  return {
    title: `${ix.name} (${ix.ticker}) — onchain stock index on Base — MAXXAGENT`,
    description: `${legs}. A tokenized stock index published onchain on Base; buy the whole basket from your own wallet with USDC or ETH. Not financial advice.`,
    alternates: { canonical: `/index/${ix.id}` },
    other: miniappEmbedTags({ siteUrl: SITE, path: `/index/${ix.id}`, buttonTitle: `Buy ${ix.ticker}` }),
  };
}

export default async function IndexPage({ params }: { params: Promise<{ id: string }> }) {
  const ix = await load((await params).id);
  if (!ix) notFound();
  const meta = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s]));
  const basket = ix.constituents.map((c) => `${c.symbol}-${Math.round(c.weightBps) / 100}`).join(",");
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  return (
    <main className="min-h-screen bg-[#03060e] px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <SiteNav />

        <div className="space-y-1">
          <div className="font-mono text-xs text-cyan-300">
            Onchain index #{ix.id} · v{ix.version}
          </div>
          <h1 className="text-2xl font-extrabold text-white">
            {ix.name} <span className="font-mono text-base text-blue-300">{ix.ticker}</span>
          </h1>
          <p className="text-xs text-slate-400">
            Created {new Date(ix.createdAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} by{" "}
            <a href={`https://basescan.org/address/${ix.creator}`} target="_blank" rel="noopener noreferrer" className="font-mono text-cyan-300 hover:underline">
              {short(ix.creator)}
            </a>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 space-y-3">
          <h2 className="text-sm font-bold text-white">Composition</h2>
          <div className="space-y-2">
            {ix.constituents.map((c) => {
              const m = meta.get(c.symbol);
              return (
                <div key={c.symbol} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <Link href={`/stock/${c.symbol}`} className="flex items-center gap-2 hover:text-cyan-300">
                      {m && <img src={m.logoUrl} alt="" className="h-6 w-6 rounded-full bg-white/5 object-contain" />}
                      <span className="font-mono font-bold text-white">{c.symbol}</span>
                      <span className="text-slate-400">{m?.companyName}</span>
                    </Link>
                    <span className="font-mono font-bold text-white">{(c.weightBps / 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#4C6FFF] to-cyan-400" style={{ width: `${c.weightBps / 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <IndexBuyBox id={ix.id} name={ix.name} ticker={ix.ticker} basket={basket} />

        <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 space-y-2 text-xs text-slate-300">
          <h2 className="text-sm font-bold text-white">Verify onchain</h2>
          <p>
            This index lives in <code className="text-cyan-300">StockMaxxIndexRegistry</code>, which stores only names and weights: no
            deposits, no fees, and only the creator can change the weights. Anyone can read it with{" "}
            <code className="text-slate-200">getIndex({ix.id})</code>.
          </p>
          <a
            href={`https://basescan.org/address/${REGISTRY}#readContract`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-cyan-300 hover:underline"
          >
            Registry on BaseScan <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <p className="text-[11px] leading-relaxed text-slate-500">
          Published by its creator, not by MAXXAGENT. Not financial advice. Tokenized stocks are not the shares themselves.
          Eligible non-US persons only: see the{" "}
          <Link href="/terms" className="underline hover:text-slate-300">
            Terms &amp; Risk Disclosure
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
