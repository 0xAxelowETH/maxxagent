import type { Metadata } from "next";
import { NextRequest } from "next/server";
import { ExternalLink } from "lucide-react";
import { GET as getStocks } from "@/app/api/stocks/route";
import { POST as runAgent } from "@/app/api/agent/route";
import { getNews } from "@/lib/newsFeed";
import { MarketHeatmap } from "@/components/MarketHeatmap";
import { NewsFeed, type NewsItem } from "@/components/NewsFeed";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BASE_TOKENIZED_STOCKS, type LiveTokenizedStock } from "@/lib/tokenizedStocks";
import { HIDDEN, indexCount, readIndexes, registryDeployed, type PublishedIndex } from "@/lib/indexRegistry";

const STOCK_META = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s]));

async function loadPublishedIndexes(timeoutMs = 4_000): Promise<{ indexes: PublishedIndex[]; totalPublished: number }> {
  if (!registryDeployed()) return { indexes: [], totalPublished: 0 };
  const query = (async () => {
    const total = await indexCount();
    if (total <= 0) return { indexes: [] as PublishedIndex[], totalPublished: 0 };
    const visibleIds = Array.from({ length: total }, (_, i) => i).filter((id) => !HIDDEN.has(id));
    if (visibleIds.length === 0) return { indexes: [] as PublishedIndex[], totalPublished: 0 };
    // Show up to 6 newest visible onchain indexes on /preview while keeping server build fast
    const latestIds = visibleIds.slice(-6).reverse();
    const list = await readIndexes(latestIds);
    return { indexes: list, totalPublished: visibleIds.length };
  })();
  const fallback = { indexes: [] as PublishedIndex[], totalPublished: 0 };
  return Promise.race([
    query.catch(() => fallback),
    new Promise<typeof fallback>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

/**
 * Read-only preview (reachable from every country, also where trading is blocked, e.g. for reviewers in the US).
 * Informational only: no wallet, no orders, no buy or sell buttons, no links into the trading pages. Every number
 * is rendered on the server, so the browser makes no request to the APIs (which stay blocked where required).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "MAXXAGENT preview (read-only)",
  description: "Read-only preview of MAXXAGENT for review. Informational only, not an offer or solicitation.",
  robots: { index: false, follow: false },
};

const SAMPLE_BRIEF = "Chips and cloud plus Palantir, nothing above 25%, keep 15% in cash";
const REGISTRY = process.env.NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS || "0xdd059D85d1327a5A4b9cA14cF0A6DF82C7b86909";

interface Report {
  interpretation: string[];
  limits: { label: string; status: string; detail: string }[];
  allocations: { symbol: string; companyName: string; logoUrl: string; capitalSharePct: number; rationale?: string }[];
  facts: { symbol: string; text: string; links: { label: string; url: string }[] }[];
  assumptions: string[];
  leftOut: { symbol: string; reason: string }[];
  cashReservePct: number;
}

// One build serves every reviewer (coalesced to prevent concurrent upstream bursts)
let cached: { at: number; full: boolean; data: Awaited<ReturnType<typeof build>> } | null = null;
let inflightPreview: Promise<Awaited<ReturnType<typeof build>>> | null = null;
async function load() {
  const ttl = cached?.full ? 600_000 : 45_000;
  if (cached && Date.now() - cached.at < ttl) return cached.data;
  if (!inflightPreview) {
    inflightPreview = build()
      .then((data) => {
        const hasLiveStocks = data.stocks.some((s) => s.source !== "fallback-snapshot");
        const full = Boolean(hasLiveStocks && data.report && data.news.length);
        if (hasLiveStocks && data.report) cached = { at: Date.now(), full, data };
        return data;
      })
      .finally(() => {
        inflightPreview = null;
      });
  }
  return inflightPreview;
}

async function build() {
  const [stocks, report, news, registry] = await Promise.all([
    getStocks(new NextRequest("http://internal/api/stocks"))
      .then((r) => r.json())
      .then((d) => (Array.isArray(d?.stocks) ? (d.stocks as LiveTokenizedStock[]) : []))
      .catch(() => [] as LiveTokenizedStock[]),
    runAgent(new NextRequest("http://internal/api/agent", { method: "POST", body: JSON.stringify({ userPrompt: SAMPLE_BRIEF, capitalUsd: 100 }) }))
      .then((r) => r.json())
      .then((d) => (d?.ok ? (d.report as Report) : null))
      .catch(() => null),
    getNews(8_000).catch(() => null),
    loadPublishedIndexes(),
  ]);
  // Official sources only (SEC filings, press releases, company newsrooms), as on the News tab
  const official = (news ?? []).filter((x) => x.kind !== "news").slice(0, 40);
  return {
    stocks,
    report,
    news: official as unknown as NewsItem[],
    indexes: registry.indexes,
    totalPublished: registry.totalPublished,
  };
}

const STATUS: Record<string, string> = {
  kept: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  adjusted: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  "not possible": "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

export default async function PreviewPage() {
  const { stocks, report, news, indexes, totalPublished } = await load();
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:py-10 text-slate-200">
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-100" data-testid="preview-notice">
        <strong>Read-only preview for review.</strong> Informational only: not an offer, solicitation or recommendation to buy or
        sell any security. Coinbase tokenized stocks are offered under Regulation S and are only available to persons in
        eligible jurisdictions outside the United States. This page has no wallet connection, no orders and no trading.
      </div>

      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/brand/maxxagent-mark.svg" alt="" className="h-10 w-10" />
            <h1 className="text-2xl font-extrabold text-white">MAXXAGENT</h1>
          </div>
          <ThemeToggle />
        </div>
        <p className="max-w-3xl text-sm text-slate-300">
          An agent for Coinbase tokenized stocks on Base. A user describes what they want in plain English; the agent researches
          with Chainlink NAV, SEC filings and DEX liquidity, keeps the user&apos;s limits, and proposes a basket. In the full app
          (eligible jurisdictions only) the user reviews every order and signs it from their own wallet; MAXXAGENT never holds funds.
        </p>
      </header>

      {stocks.length > 0 && <MarketHeatmap stocks={stocks} links={false} />}

      <section className="glass-panel space-y-4 rounded-3xl p-4 sm:p-6" data-testid="preview-agent">
        <div>
          <h2 className="text-lg font-bold text-white">Example: the agent&apos;s research for one brief</h2>
          <p className="mt-1 text-xs text-slate-400">
            Brief: <span className="font-mono text-slate-200">&ldquo;{SAMPLE_BRIEF}&rdquo;</span> · computed live at{" "}
            {new Date().toISOString().slice(11, 16)} UTC. Prices and pools move, so a later run can weigh the stocks differently.
          </p>
        </div>
        {!report ? (
          <p className="text-xs text-slate-400">The example is unavailable right now. Reload in a minute.</p>
        ) : (
          <>
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-300">
              {report.interpretation.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Limits</h3>
              {report.limits.map((l) => (
                <div key={l.label} className="flex flex-wrap items-start gap-2 text-xs">
                  <span className={`rounded-full border px-2 py-0.5 font-bold ${STATUS[l.status] ?? "border-slate-600 text-slate-300"}`}>{l.status}</span>
                  <span className="font-semibold text-slate-100">{l.label}</span>
                  <span className="text-slate-400">{l.detail}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Proposed weights (share of the money)</h3>
              <ul className="space-y-2">
                {report.allocations.map((a) => (
                  <li key={a.symbol} className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
                    <div className="flex items-center gap-3">
                      <img src={a.logoUrl} alt="" className="h-8 w-8 rounded-full bg-white/90 p-0.5" />
                      <span className="font-mono font-bold text-white">{a.symbol}</span>
                      <span className="text-xs text-slate-400">{a.companyName}</span>
                      <span className="ml-auto font-mono font-bold text-cyan-200">{a.capitalSharePct.toFixed(1)}%</span>
                    </div>
                    {a.rationale && <p className="mt-1.5 text-[11px] text-slate-400">{a.rationale}</p>}
                  </li>
                ))}
                <li className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#070b14] p-3 text-sm">
                  <span className="font-bold text-white">Cash (USDC)</span>
                  <span className="font-mono font-bold text-emerald-300">{report.cashReservePct}%</span>
                </li>
              </ul>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-300">Facts, with sources</h3>
                {report.facts.map((f) => (
                  <div key={f.symbol} className="text-[11px] leading-relaxed text-slate-300">
                    <span className="font-mono font-bold text-white">{f.symbol}</span> {f.text}
                    <div className="mt-0.5 flex flex-wrap gap-x-3">
                      {f.links.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline hover:text-white">
                          {l.label}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Assumptions</h3>
                  <ul className="list-disc space-y-1 pl-5 text-[11px] text-slate-300">
                    {report.assumptions.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Not picked, and why</h3>
                  <ul className="space-y-1 text-[11px] text-slate-400">
                    {report.leftOut.map((l) => (
                      <li key={l.symbol}>
                        <span className="font-mono font-bold text-slate-200">{l.symbol}</span> {l.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Rule-based research for illustration, not advice.</p>
          </>
        )}
      </section>

      <section data-testid="preview-indexes" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white">
              Published onchain indexes
              {totalPublished > 0 && (
                <span className="ml-2 font-mono text-[11px] font-normal text-slate-400">
                  · {totalPublished} on Base
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-400">
              {totalPublished > indexes.length && indexes.length > 0
                ? `Read-only weights stored in StockMaxxIndexRegistry on Base Mainnet (newest ${indexes.length} of ${totalPublished}).`
                : "Read-only weights stored in StockMaxxIndexRegistry on Base Mainnet."}
            </p>
          </div>
          {registryDeployed() && (
            <a
              href={`https://basescan.org/address/${REGISTRY}#readContract`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-cyan-300 hover:underline"
            >
              Verify registry <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {indexes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-[#0b1120] p-4 text-xs text-slate-400">
            Registry data is temporarily unavailable. Weights can be inspected directly in{" "}
            <a
              href={`https://basescan.org/address/${REGISTRY}#readContract`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-300 underline"
            >
              StockMaxxIndexRegistry on BaseScan
            </a>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {indexes.map((ix) => (
              <article
                key={ix.id}
                className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex shrink-0 -space-x-2 py-0.5 pl-0.5">
                      {ix.constituents.slice(0, 4).map((c) => {
                        const meta = STOCK_META.get(c.symbol);
                        return meta ? (
                          <img
                            key={c.symbol}
                            src={meta.logoUrl}
                            alt=""
                            className="h-7 w-7 rounded-full bg-slate-900 object-cover maxx-avatar-ring"
                          />
                        ) : null;
                      })}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold leading-snug text-white line-clamp-1">{ix.name}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className="rounded bg-[#4C6FFF]/20 px-1.5 py-0.5 font-mono font-bold text-blue-200">
                          {ix.ticker}
                        </span>
                        <span className="font-mono text-slate-400">
                          #{ix.id} · v{ix.version} · {ix.creator.slice(0, 6)}…{ix.creator.slice(-4)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    Read-only
                  </span>
                </div>

                <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  {ix.constituents.map((c) => (
                    <div
                      key={c.symbol}
                      style={{
                        width: `${c.weightBps / 100}%`,
                        backgroundColor: STOCK_META.get(c.symbol)?.color || "#4C6FFF",
                      }}
                      title={`${c.symbol} ${(c.weightBps / 100).toFixed(1)}%`}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-[11px]">
                  {ix.constituents.map((c) => (
                    <div key={c.symbol} className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: STOCK_META.get(c.symbol)?.color || "#4C6FFF" }}
                      />
                      <span className="font-mono text-slate-200">{c.symbol}</span>
                      <span className="ml-auto font-mono text-slate-400">{(c.weightBps / 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <NewsFeed initialItems={news} stockLinks={false} limit={10} title="News & filings" />

      <footer className="space-y-1 border-t border-slate-800 pt-4 text-[11px] text-slate-500">
        <p>
          Open source (MIT):{" "}
          <a href="https://github.com/0xAxelowETH/maxxagent" target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
            github.com/0xAxelowETH/maxxagent
          </a>{" "}
          · Index registry contract (verified):{" "}
          <a href={`https://basescan.org/address/${REGISTRY}#code`} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
            BaseScan
          </a>
        </p>
        <p>Not affiliated with, endorsed or sponsored by Coinbase, Base, Chainlink, KyberSwap, Stocks Maxxing partners, or any public company whose stock is referenced. Not financial advice.</p>
      </footer>
    </main>
  );
}
