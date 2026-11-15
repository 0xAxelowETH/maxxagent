"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Newspaper } from "lucide-react";

interface NewsItem {
  symbol: string;
  kind: "news" | "filing";
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  changePct: number | null;
  priceSource: "DEX" | "NAV" | null;
}

const ago = (iso: string) => {
  const m = (Date.now() - Date.parse(iso)) / 60_000;
  if (m < 60) return `${Math.max(1, Math.round(m))} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

/**
 * Headlines and SEC filings for one stock (symbol) or all supported stocks, each with the price change since it
 * was published. Only the headline, outlet, time and a link to the original are shown.
 */
export function NewsFeed({ symbol, limit = 8, title = "News & filings" }: { symbol?: string; limit?: number; title?: string }) {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "news" | "filing">("all");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) =>
      fetch(`/api/news${symbol ? `?symbol=${symbol}` : ""}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d?.ok) setItems(d.items);
          else if (d?.loading && attempt < 5) timer = setTimeout(() => load(attempt + 1), 8000);
          else setError(d?.error || "News is unavailable right now.");
        })
        .catch(() => !cancelled && setError("News is unavailable right now."));
    load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [symbol]);

  const shown = (items ?? []).filter((x) => filter === "all" || x.kind === filter).slice(0, limit);
  // The filter only makes sense when both headlines and filings are there
  const mixed = Boolean(items?.some((x) => x.kind === "news") && items?.some((x) => x.kind === "filing"));

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4" data-testid="news-feed">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-white">{title}</h2>
        {mixed && (
        <div className="inline-flex rounded-lg border border-slate-700 bg-[#040814] p-0.5 text-[11px]" role="group" aria-label="Show">
          {(["all", "news", "filing"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 font-bold cursor-pointer ${filter === f ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {f === "all" ? "All" : f === "news" ? "Headlines" : "SEC filings"}
            </button>
          ))}
        </div>
        )}
      </div>

      {!items && !error && <p className="text-xs text-slate-500">Loading the latest headlines and filings…</p>}
      {error && <p className="text-xs text-slate-500">{error}</p>}
      {items && shown.length === 0 && <p className="text-xs text-slate-500">Nothing in the last few days.</p>}

      <ul className="divide-y divide-slate-800/80">
        {shown.map((x) => (
          <li key={`${x.kind}:${x.url}:${x.symbol}`} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 shrink-0 text-slate-500" aria-hidden>
              {x.kind === "filing" ? <FileText className="h-4 w-4" /> : <Newspaper className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
                {!symbol && (
                  <Link href={`/stock/${x.symbol}`} className="font-mono font-bold text-cyan-300 hover:underline">
                    {x.symbol}
                  </Link>
                )}
                <span>{x.kind === "filing" ? "Official SEC filing" : `Reported by ${x.source}`}</span>
                <span>· {ago(x.publishedAt)}</span>
              </div>
              <a href={x.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-xs font-semibold leading-snug text-slate-100 hover:text-white hover:underline">
                {x.title}
              </a>
            </div>
            <div className="shrink-0 text-right">
              {x.changePct !== null ? (
                <>
                  <div className={`font-mono text-xs font-bold ${x.changePct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {x.changePct >= 0 ? "+" : ""}
                    {x.changePct.toFixed(2)}%
                  </div>
                  <div className="text-[9px] text-slate-500">since published ({x.priceSource})</div>
                </>
              ) : (
                <div className="text-[10px] text-slate-600">no price yet</div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        Headlines link to the original publisher; filings to sec.gov. The change is the token&apos;s price now vs when the item
        was published (24/7 DEX price, or the Chainlink NAV for older items). It doesn&apos;t mean the item caused the move. For
        reference only, not financial advice.
      </p>
    </div>
  );
}
