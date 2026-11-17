import type { Metadata } from "next";
import { NextRequest } from "next/server";
import { GET as getStocks } from "@/app/api/stocks/route";
import { POST as runAgent } from "@/app/api/agent/route";
import { getNews } from "@/lib/newsFeed";
import { MarketHeatmap } from "@/components/MarketHeatmap";
import { NewsFeed, type NewsItem } from "@/components/NewsFeed";
import type { LiveTokenizedStock } from "@/lib/tokenizedStocks";

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

// One build serves every reviewer for 10 minutes (the agent run and the news wait take seconds); kept only when complete
let cached: { at: number; data: Awaited<ReturnType<typeof build>> } | null = null;
async function load() {
  if (cached && Date.now() - cached.at < 600_000) return cached.data;
  const data = await build();
  if (data.stocks.length && data.report && data.news.length) cached = { at: Date.now(), data };
  return data;
}

async function build() {
  const [stocks, report, news] = await Promise.all([
    getStocks(new NextRequest("http://internal/api/stocks"))
      .then((r) => r.json())
      .then((d) => (Array.isArray(d?.stocks) ? (d.stocks as LiveTokenizedStock[]) : []))
      .catch(() => [] as LiveTokenizedStock[]),
    runAgent(new NextRequest("http://internal/api/agent", { method: "POST", body: JSON.stringify({ userPrompt: SAMPLE_BRIEF, capitalUsd: 100 }) }))
      .then((r) => r.json())
      .then((d) => (d?.ok ? (d.report as Report) : null))
      .catch(() => null),
    getNews(8_000).catch(() => null),
  ]);
  // Official sources only (SEC filings, press releases, company newsrooms), as on the News tab
  const official = (news ?? []).filter((x) => x.kind !== "news").slice(0, 40);
  return { stocks, report, news: official as unknown as NewsItem[] };
}

const STATUS: Record<string, string> = {
  kept: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  adjusted: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  "not possible": "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

export default async function PreviewPage() {
  const { stocks, report, news } = await load();
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:py-10 text-slate-200">
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-100" data-testid="preview-notice">
        <strong>Read-only preview for review.</strong> Informational only: not an offer, solicitation or recommendation to buy or
        sell any security. Coinbase tokenized stocks are offered under Regulation S and are only available to persons in
        eligible jurisdictions outside the United States. This page has no wallet connection, no orders and no trading.
      </div>

      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <img src="/brand/maxxagent-mark.svg" alt="" className="h-10 w-10" />
          <h1 className="text-2xl font-extrabold text-white">MAXXAGENT</h1>
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
            Brief: <span className="font-mono text-slate-200">&ldquo;{SAMPLE_BRIEF}&rdquo;</span> · computed live from current data
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
