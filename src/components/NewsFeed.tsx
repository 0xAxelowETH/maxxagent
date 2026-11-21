"use client";

import { useEffect, useMemo, useState } from "react";
import { MaxxLoader } from "@/components/MaxxLoader";
import Link from "next/link";
import { Building2, FileText, Megaphone, Newspaper } from "lucide-react";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";

const LOGO: Record<string, string> = Object.fromEntries(BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s.logoUrl]));

export interface NewsItem {
  symbol: string;
  kind: "news" | "filing" | "newsroom";
  title: string;
  summary?: string;
  form?: string;
  pressRelease?: boolean;
  tags?: string[];
  source: string;
  url: string;
  publishedAt: string;
  priceThen: number | null;
  priceNow: number | null;
  changePct: number | null;
  priceSource: "DEX" | "NAV" | null;
}
type Kind = "all" | "press" | "newsroom" | "filing" | "news";
const kindOf = (x: NewsItem): Exclude<Kind, "all"> =>
  x.kind === "news" ? "news" : x.kind === "newsroom" ? "newsroom" : x.pressRelease ? "press" : "filing";

// Items are grouped by New York date: the trading day the news belongs to, the same for every visitor
const NY = "America/New_York";
const nyKey = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: NY });
const ago = (iso: string, nowMs: number | null) => {
  const d = new Date(iso);
  if (nowMs === null) {
    return `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: NY })} ET`;
  }
  const m = (nowMs - d.getTime()) / 60_000;
  if (m < 60) return `${Math.max(1, Math.round(m))} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};
const dayLabel = (iso: string, nowMs: number | null) => {
  const d = new Date(iso);
  if (nowMs !== null) {
    if (nyKey(d) === nyKey(new Date(nowMs))) return "Today (New York)";
    if (nyKey(d) === nyKey(new Date(nowMs - 86_400_000))) return "Yesterday (New York)";
  }
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: NY });
};
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A link to the stock page, or plain text where those pages aren't available */
function MaybeLink({ on, href, className, title, children }: { on: boolean; href: string; className?: string; title?: string; children: React.ReactNode }) {
  return on ? (
    <Link href={href} className={className} title={title}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

const BADGE: Record<Exclude<Kind, "all">, { label: string; cls: string; Icon: typeof FileText }> = {
  press: { label: "Press release", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", Icon: Megaphone },
  newsroom: { label: "Company news", cls: "border-indigo-400/40 bg-indigo-500/10 text-indigo-200", Icon: Building2 },
  filing: { label: "SEC filing", cls: "border-slate-600 bg-slate-800/60 text-slate-300", Icon: FileText },
  news: { label: "Headline", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300", Icon: Newspaper },
};

/**
 * Official filings and press releases (and headlines where a licensed source is configured) for one stock or
 * all supported stocks, each with the token's price change since it was published. Only titles, short
 * openings and links to the originals are shown.
 */
export function NewsFeed({
  symbol,
  limit = 12,
  title = "News & filings",
  initialItems,
  stockLinks = true,
  onTrade,
  onAsk,
}: {
  symbol?: string;
  limit?: number;
  title?: string;
  /** items rendered by the server (the read-only preview): no request from the browser */
  initialItems?: NewsItem[];
  /** link each item's stock to its page (off in the preview, where those pages aren't open) */
  stockLinks?: boolean;
  /**
   * On the home page itself, a link to "/?stock=…" changes only the URL (the page stays mounted and reads its
   * query once), so the home page passes these to act directly instead
   */
  onTrade?: (symbol: string) => void;
  onAsk?: (prompt: string) => void;
}) {
  const [items, setItems] = useState<NewsItem[] | null>(initialItems ?? null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [stock, setStock] = useState<string>(symbol ?? "all");
  const [shown, setShown] = useState(limit);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (initialItems) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) =>
      fetch(`/api/news${symbol ? `?symbol=${symbol}` : ""}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d?.ok) setItems(d.items);
          else if (d?.loading && attempt < 6) timer = setTimeout(() => load(attempt + 1), 8000);
          else setError(d?.error || "News is unavailable right now.");
        })
        .catch(() => !cancelled && setError("News is unavailable right now."));
    load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [symbol, initialItems]);

  const all = useMemo(() => items ?? [], [items]);
  const kinds = useMemo(() => (["press", "newsroom", "filing", "news"] as const).filter((k) => all.some((x) => kindOf(x) === k)), [all]);
  const stocks = useMemo(() => [...new Set(all.map((x) => x.symbol))], [all]);
  const filtered = all.filter((x) => (kind === "all" || kindOf(x) === kind) && (stock === "all" || x.symbol === stock));
  const visible = filtered.slice(0, shown);

  // Headline numbers for the selection
  const priced = filtered.filter((x) => x.changePct !== null);
  const biggest = priced.reduce<NewsItem | null>((b, x) => (!b || Math.abs(x.changePct!) > Math.abs(b.changePct!) ? x : b), null);
  const press = filtered.filter((x) => kindOf(x) === "press" || kindOf(x) === "newsroom").length;

  // Group the visible items by day
  const groups: { day: string; list: NewsItem[] }[] = [];
  for (const x of visible) {
    const day = dayLabel(x.publishedAt, nowMs);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.list.push(x);
    else groups.push({ day, list: [x] });
  }

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold cursor-pointer transition ${
      active ? "border-cyan-400 bg-cyan-500/15 text-cyan-200" : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
    }`;

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 sm:p-5" data-testid="news-feed">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-white">{title}</h2>
          <p className="text-[11px] text-slate-500">Official SEC filings, press releases and company newsrooms, with the price change since each was published.</p>
        </div>
        {kinds.length > 1 && (
          <div className="inline-flex rounded-lg border border-slate-700 bg-[#040814] p-0.5 text-[11px]" role="group" aria-label="Type">
            {(["all", ...kinds] as Kind[]).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setKind(k);
                  setShown(limit);
                }}
                className={`rounded-md px-2.5 py-1 font-bold cursor-pointer ${kind === k ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                {k === "all" ? "All" : k === "press" ? "Press releases" : k === "newsroom" ? "Company news" : k === "filing" ? "SEC filings" : "Headlines"}
              </button>
            ))}
          </div>
        )}
      </div>

      {items && filtered.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="news-summary">
          <div className="rounded-xl border border-slate-800 bg-[#070b14] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Items, last 30 days</div>
            <div className="font-mono text-lg font-bold text-white">{filtered.length}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#070b14] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Official announcements</div>
            <div className="font-mono text-lg font-bold text-emerald-300">{press}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#070b14] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Biggest move since published</div>
            {biggest ? (
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-slate-200">{biggest.symbol}</span>
                <span className={`font-mono text-lg font-bold ${biggest.changePct! >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {biggest.changePct! >= 0 ? "+" : ""}
                  {biggest.changePct!.toFixed(2)}%
                </span>
              </div>
            ) : (
              <div className="text-sm text-slate-500">–</div>
            )}
          </div>
        </div>
      )}

      {!symbol && stocks.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Stock">
          <button onClick={() => { setStock("all"); setShown(limit); }} className={chip(stock === "all")}>
            All stocks
          </button>
          {stocks.map((s) => (
            <button key={s} onClick={() => { setStock(s); setShown(limit); }} className={chip(stock === s)}>
              {LOGO[s] && <img src={LOGO[s]} alt="" className="h-4 w-4 rounded-full object-cover" />}
              {s}
            </button>
          ))}
        </div>
      )}

      {!items && !error && <MaxxLoader className="mt-4" label="Loading the latest filings and press releases…" />}
      {error && <p className="mt-4 text-xs text-slate-500">{error}</p>}
      {items && filtered.length === 0 && <p className="mt-4 text-xs text-slate-500">Nothing in the last 30 days.</p>}

      <div className="mt-3 space-y-4">
        {groups.map((g) => (
          <section key={g.day}>
            <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.day}</h3>
            <ul className="space-y-2">
              {g.list.map((x) => {
                const b = BADGE[kindOf(x)];
                return (
                  <li key={`${x.kind}:${x.url}:${x.symbol}`} className="rounded-xl border border-slate-800 bg-[#070b14] p-3 transition hover:border-slate-600">
                    <div className="flex items-start gap-3">
                      <MaybeLink on={stockLinks} href={`/stock/${x.symbol}`} className="shrink-0" title={`${x.symbol} stock page`}>
                        {LOGO[x.symbol] ? (
                          <img src={LOGO[x.symbol]} alt={x.symbol} className="h-9 w-9 rounded-full border border-slate-700 bg-slate-900 object-cover" />
                        ) : (
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-800 font-mono text-[9px] text-slate-300">{x.symbol}</span>
                        )}
                      </MaybeLink>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                          <MaybeLink on={stockLinks} href={`/stock/${x.symbol}`} className="font-mono font-bold text-cyan-300 hover:underline">
                            {x.symbol}
                          </MaybeLink>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-bold ${b.cls}`}>
                            <b.Icon className="h-3 w-3" aria-hidden />
                            {b.label}
                            {x.form ? ` · ${x.form}` : ""}
                          </span>
                          {(x.tags ?? []).map((t) => (
                            <span key={t} className="rounded-full bg-slate-800 px-1.5 py-0.5 text-slate-300">
                              {t}
                            </span>
                          ))}
                          <span title={new Date(x.publishedAt).toUTCString()}>· {ago(x.publishedAt, nowMs)}</span>
                          {x.kind !== "filing" && <span>· {x.source}</span>}
                        </div>
                        <a href={x.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[13px] font-bold leading-snug text-slate-100 hover:text-white hover:underline">
                          {x.title}
                        </a>
                        {x.summary && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-400">{x.summary}</p>}
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <a href={x.url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-cyan-300 hover:text-white hover:underline">
                              {x.kind !== "filing" ? `Read on ${x.source} →` : x.pressRelease ? "Read the press release on sec.gov →" : "Read the filing on sec.gov →"}
                            </a>
                            {stockLinks &&
                              (() => {
                                const askPrompt = `Evaluate ${x.symbol} and related peers after latest ${x.form || kindOf(x)}`;
                                const tradeCls =
                                  "rounded-md border border-[#4C6FFF]/40 bg-[#4C6FFF]/15 px-2 py-0.5 text-[10px] font-semibold text-blue-200 hover:bg-[#4C6FFF]/30 transition cursor-pointer";
                                const askCls =
                                  "rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10px] font-semibold text-slate-300 hover:border-cyan-400/50 hover:text-white transition cursor-pointer";
                                return (
                                  <>
                                    {onTrade ? (
                                      <button type="button" onClick={() => onTrade(x.symbol)} className={tradeCls}>
                                        Trade {x.symbol}
                                      </button>
                                    ) : (
                                      <Link href={`/?stock=${encodeURIComponent(x.symbol)}`} className={tradeCls}>
                                        Trade {x.symbol}
                                      </Link>
                                    )}
                                    {onAsk ? (
                                      <button type="button" onClick={() => onAsk(askPrompt)} className={askCls}>
                                        Ask Agent
                                      </button>
                                    ) : (
                                      <Link href={`/?tab=agent&prompt=${encodeURIComponent(askPrompt)}`} className={askCls}>
                                        Ask Agent
                                      </Link>
                                    )}
                                  </>
                                );
                              })()}
                          </div>
                          {x.changePct !== null ? (
                            <span className="inline-flex items-center gap-2 text-[10px] text-slate-400" title={`Price source: ${x.priceSource === "DEX" ? "24/7 DEX price" : "Chainlink NAV"}`}>
                              {x.priceThen !== null && x.priceNow !== null && (
                                <span className="font-mono tabular-nums">
                                  {usd(x.priceThen)} → {usd(x.priceNow)}
                                </span>
                              )}
                              <span
                                className={`rounded-md px-1.5 py-0.5 font-mono tabular-nums text-[11px] font-bold ${
                                  x.changePct >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                                }`}
                              >
                                {x.changePct >= 0 ? "+" : ""}
                                {x.changePct.toFixed(2)}%
                              </span>
                              <span>since published ({x.priceSource})</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">no price yet</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {filtered.length > shown && (
        <button
          onClick={() => setShown((n) => n + limit)}
          className="mt-3 w-full rounded-xl border border-slate-700 py-2 text-xs font-bold text-slate-300 hover:border-slate-500 hover:text-white cursor-pointer"
        >
          Show more ({filtered.length - shown} more)
        </button>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
        Source: SEC EDGAR (public filings; press releases are the exhibits companies attach to them)
        {all.some((x) => x.kind === "newsroom") ? "; company news from each company's official newsroom feed" : ""}
        {all.some((x) => x.kind === "news") ? "; headlines from a licensed news provider" : ""}. Titles and openings link to
        the originals. The change is the token&apos;s price now vs when the item was published (24/7 DEX price, or the
        Chainlink NAV for older items); it doesn&apos;t mean the item caused the move. For reference only, not financial advice.
      </p>
    </div>
  );
}
