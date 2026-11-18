"use client";

import { useEffect, useState } from "react";
import { MarketStatus } from "./MarketStatus";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { earningsLabel, recentEarnings } from "@/lib/earnings";

interface Live {
  navPrice: number;
  dexPrice24_7: number;
  weekendGapPct: number;
  change24hPct: number;
  dexLiquidityUsd?: number;
  dexVolume24hUsd?: number;
  totalSupplyTokens: number;
  onchainMarketCapUsd: number;
  uiMultiplier: number;
  b20PolicyId?: number | null;
  oracleAgeMinutes: number;
  isOracleStale: boolean;
}
type Point = [number, number];
interface NewsMark {
  kind: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  pressRelease?: boolean;
  tags?: string[];
  changePct: number | null;
}

const usd = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const compact = (n: number) => `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n)}`;
const ago = (m: number) => (m < 60 ? `${Math.round(m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`);
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;

/** Live numbers + 7-day NAV vs DEX chart for one stock (public data only, no wallet). */
export function StockLive({ symbol, color }: { symbol: string; color: string }) {
  const [live, setLive] = useState<Live | null>(null);
  const [failed, setFailed] = useState(false);
  const [hist, setHist] = useState<{ nav: Point[]; dex: Point[] } | null>(null);
  const [news, setNews] = useState<NewsMark[]>([]);

  useEffect(() => {
    let off = false;
    fetch("/api/stocks")
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        const s = d?.stocks?.find((x: { symbol: string }) => x.symbol === symbol);
        if (s) setLive(s);
        else setFailed(true);
      })
      .catch(() => !off && setFailed(true));
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&tf=7D`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        setHist(d?.ok ? { nav: d.nav || [], dex: d.dex || [] } : { nav: [], dex: [] });
      })
      .catch(() => !off && setHist({ nav: [], dex: [] }));
    // News and filings to pin on the chart (the feed is cached; "loading" right after a deploy just means no dots yet)
    fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => !off && d?.ok && Array.isArray(d.items) && setNews(d.items))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [symbol]);

  const cards: [string, string, string?][] = live
    ? [
        ["Chainlink NAV", usd(live.navPrice), live.isOracleStale ? "oracle stale" : `updated ${ago(live.oracleAgeMinutes)}`],
        ["Base DEX price", usd(live.dexPrice24_7), `${pct(live.weekendGapPct)} vs NAV`],
        ["24h change", pct(live.change24hPct)],
        ["DEX liquidity", live.dexLiquidityUsd ? compact(live.dexLiquidityUsd) : "—"],
        ["DEX volume 24h", live.dexVolume24hUsd ? compact(live.dexVolume24hUsd) : "—"],
        ["Onchain market cap", compact(live.onchainMarketCapUsd), `${live.totalSupplyTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} tokens`],
        ["Multiplier", live.uiMultiplier.toFixed(6), "dividends & splits"],
      ]
    : [];

  return (
    <div className="space-y-4">
      <MarketStatus showDetail className="text-[11px]" />
      {(() => {
        const e = recentEarnings(news.map((n) => ({ ...n, symbol })))[symbol];
        return e ? (
          <a href={e.url} target="_blank" rel="noopener noreferrer" data-testid="earnings-badge" className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:border-amber-300">
            {earningsLabel(e)} · read the SEC report ↗
          </a>
        ) : null;
      })()}
      {failed ? (
        <p className="text-xs text-amber-200">Live data is unavailable right now. Please retry in a moment.</p>
      ) : !live ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-800/50" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="stock-live">
          {cards.map(([k, v, sub]) => (
            <div key={k} className="rounded-xl border border-slate-800 bg-[#0b1120] p-3">
              <div className="text-[10px] text-slate-400">{k}</div>
              <div className="font-mono text-sm font-bold text-white">{v}</div>
              {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
            </div>
          ))}
        </div>
      )}
      <Chart hist={hist} color={color} news={news} />
      {live && <B20Panel symbol={symbol} live={live} />}
    </div>
  );
}

const KIND_DOT: Record<string, string> = { press: "#34d399", newsroom: "#a5b4fc", filing: "#94a3b8", news: "#38bdf8" };
const kindOf = (n: NewsMark) => (n.kind === "filing" ? (n.pressRelease ? "press" : "filing") : n.kind);
const KIND_LABEL: Record<string, string> = { press: "Press release", newsroom: "Company news", filing: "SEC filing", news: "Headline" };

function Chart({ hist, color, news }: { hist: { nav: Point[]; dex: Point[] } | null; color: string; news: NewsMark[] }) {
  const W = 600;
  const H = 180;
  if (!hist) return <div className="h-[180px] animate-pulse rounded-2xl bg-slate-800/40" />;
  const all = [...hist.nav, ...hist.dex];
  if (all.length < 2) return <p className="text-xs text-slate-500">No price history available yet.</p>;
  const t0 = Math.min(...all.map((p) => p[0]));
  const t1 = Math.max(...all.map((p) => p[0]));
  const lo = Math.min(...all.map((p) => p[1]));
  const hi = Math.max(...all.map((p) => p[1]));
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const y = (v: number) => H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 16);
  const path = (pts: Point[]) =>
    [...pts].sort((a, b) => a[0] - b[0]).map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  // Price line to pin a dot on: the DEX line (24/7) when there is one, else the NAV
  const line = [...(hist.dex.length > 1 ? hist.dex : hist.nav)].sort((a, b) => a[0] - b[0]);
  const priceAt = (t: number) => {
    let v = line[0][1];
    for (const [ts, p] of line) {
      if (ts > t) break;
      v = p;
    }
    return v;
  };
  const marks = news
    .map((n) => ({ n, t: Date.parse(n.publishedAt) / 1000 }))
    .filter(({ t }) => t >= t0 && t <= t1)
    // Official items first (press releases, company newsrooms, filings), then any headlines, at most 12 dots
    .sort((a, b) => Number(a.n.kind === "news") - Number(b.n.kind === "news"))
    .slice(0, 12);
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
        <span className="font-semibold text-slate-200">7 days</span>
        <span className="flex gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3" style={{ background: color }} /> Chainlink NAV
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 bg-cyan-400" /> Base DEX
          </span>
        </span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full" preserveAspectRatio="none" role="img" aria-label="7-day price chart">
          {hist.nav.length > 1 && <path d={path(hist.nav)} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
          {hist.dex.length > 1 && <path d={path(hist.dex)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
          {marks.map(({ n, t }) => (
            <line key={`l${n.url}`} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke={KIND_DOT[kindOf(n)] ?? "#94a3b8"} strokeOpacity="0.25" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {/* News dots: HTML on top of the SVG so they stay round; hover for the title, click for the original */}
        {marks.map(({ n, t }) => {
          const left = (x(t) / W) * 100;
          const k = kindOf(n);
          return (
            <a
              key={n.url}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${left}%`, top: `${(y(priceAt(t)) / H) * 100}%` }}
              aria-label={`${KIND_LABEL[k] ?? "News"}: ${n.title}`}
            >
              <span className="block h-3 w-3 rounded-full border-2 border-[#0b1120] shadow" style={{ background: KIND_DOT[k] ?? "#94a3b8" }} />
              <span
                className={`pointer-events-none absolute bottom-4 z-10 hidden w-56 rounded-lg border border-slate-700 bg-[#050811] p-2 text-[10px] leading-snug text-slate-300 shadow-xl group-hover:block group-focus:block ${
                  left > 60 ? "right-0" : "left-0"
                }`}
              >
                <span className="block font-bold text-white">{n.title}</span>
                <span className="mt-0.5 block text-slate-500">
                  {KIND_LABEL[k] ?? "News"} · {new Date(n.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}
                  {n.changePct !== null ? ` · ${n.changePct >= 0 ? "+" : ""}${n.changePct.toFixed(2)}% since` : ""}
                </span>
              </span>
            </a>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
        <span>{usd(lo)}</span>
        <span>{usd(hi)}</span>
      </div>
      {marks.length > 0 && (
        <p className="mt-1 text-[10px] text-slate-500" data-testid="chart-news">
          {marks.length} news item{marks.length > 1 ? "s" : ""} and filing{marks.length > 1 ? "s" : ""} on the chart: hover a dot for the title, click to open the original. A dot marks timing only, not a cause.
        </p>
      )}
    </div>
  );
}

/** What the token itself does, read onchain: Base's B20 standard (multiplier for dividends and splits, issuer transfer policy) */
function B20Panel({ symbol, live }: { symbol: string; live: Live }) {
  const meta = BASE_TOKENIZED_STOCKS.find((s) => s.symbol === symbol);
  const policy = live.b20PolicyId;
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-3 text-[11px] text-slate-300" data-testid="b20-panel">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-white">Built on B20, Base&apos;s token standard</span>
        {meta && (
          <a href={meta.basescanUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">
            Token contract ↗
          </a>
        )}
      </div>
      <ul className="space-y-1">
        <li>
          <b className="text-slate-100">Dividends &amp; splits:</b> carried by the token&apos;s multiplier, now{" "}
          <span className="font-mono">{live.uiMultiplier.toFixed(6)}×</span>. Share counts and values here already include it.
        </li>
        <li>
          <b className="text-slate-100">Transfer policy:</b>{" "}
          {policy === null || policy === undefined
            ? "couldn't be read right now."
            : policy === 0
            ? "none set by the issuer (policy 0)."
            : `policy #${policy} set by the issuer, which decides who may hold or receive the token.`}
        </li>
        <li>
          <b className="text-slate-100">Price:</b> Chainlink NAV onchain, plus the 24/7 Base DEX price.
        </li>
      </ul>
    </div>
  );
}
