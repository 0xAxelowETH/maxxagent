"use client";

import { useEffect, useState } from "react";
import { MarketStatus } from "./MarketStatus";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { earningsLabel, recentEarnings } from "@/lib/earnings";
import { splitNavWeekendGaps, usMarketStatus } from "@/lib/marketHours";
import { summarizeSeries } from "@/lib/chartMetrics";

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

/** Live numbers + interactive 24H/7D/30D NAV vs DEX chart for one stock (public data only, no wallet). */
export function StockLive({ symbol, color }: { symbol: string; color: string }) {
  const [live, setLive] = useState<Live | null>(null);
  const [failed, setFailed] = useState(false);
  const [tf, setTf] = useState<"24H" | "7D" | "30D">("7D");
  const [hist, setHist] = useState<{ nav: Point[]; dex: Point[] } | null>(null);
  const [news, setNews] = useState<NewsMark[]>([]);
  const [sessionLabel, setSessionLabel] = useState<{ label: string; open: boolean } | null>(null);

  useEffect(() => {
    const update = () => {
      const st = usMarketStatus();
      setSessionLabel({ label: st.state === "open" ? "NY open" : "NY closed", open: st.state === "open" });
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

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
    // News and filings to pin on the chart (the feed is cached; "loading" right after a deploy just means no dots yet)
    fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => !off && d?.ok && Array.isArray(d.items) && setNews(d.items))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [symbol]);

  useEffect(() => {
    let off = false;
    setHist(null);
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&tf=${tf}`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        setHist(d?.ok ? { nav: d.nav || [], dex: d.dex || [] } : { nav: [], dex: [] });
      })
      .catch(() => !off && setHist({ nav: [], dex: [] }));
    return () => {
      off = true;
    };
  }, [symbol, tf]);

  const cards: [string, string, string?][] = live
    ? [
        ["Chainlink NAV", usd(live.navPrice), live.isOracleStale ? "oracle stale" : `updated ${ago(live.oracleAgeMinutes)}`],
        ["Base DEX price", usd(live.dexPrice24_7), `${pct(live.weekendGapPct)} vs NAV`],
        ["24h change", pct(live.change24hPct)],
        ["DEX liquidity", live.dexLiquidityUsd ? compact(live.dexLiquidityUsd) : "—"],
        ["DEX volume 24h", live.dexVolume24hUsd ? compact(live.dexVolume24hUsd) : "—"],
        ["Onchain market cap", compact(live.onchainMarketCapUsd), `${live.totalSupplyTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} tokens`],
        ["Multiplier", live.uiMultiplier.toFixed(6), "dividends & splits"],
        ["Trading venue", sessionLabel?.label ?? "24/7 DEX", sessionLabel?.open ? "NAV & DEX live" : "DEX live · NAV paused"],
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
              <div className="font-mono tabular-nums text-sm font-bold text-white">{v}</div>
              {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
            </div>
          ))}
        </div>
      )}
      <Chart hist={hist} color={color} news={news} tf={tf} onTfChange={setTf} />
      {live && <B20Panel symbol={symbol} live={live} />}
    </div>
  );
}

const KIND_DOT: Record<string, string> = { press: "#34d399", newsroom: "#a5b4fc", filing: "#94a3b8", news: "#38bdf8" };
const kindOf = (n: NewsMark) => (n.kind === "filing" ? (n.pressRelease ? "press" : "filing") : n.kind);
const KIND_LABEL: Record<string, string> = { press: "Press release", newsroom: "Company news", filing: "SEC filing", news: "Headline" };

function Chart({
  hist,
  color,
  news,
  tf,
  onTfChange,
}: {
  hist: { nav: Point[]; dex: Point[] } | null;
  color: string;
  news: NewsMark[];
  tf: "24H" | "7D" | "30D";
  onTfChange: (next: "24H" | "7D" | "30D") => void;
}) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [showNav, setShowNav] = useState(true);
  const [showDex, setShowDex] = useState(true);
  const W = 600;
  const H = 190;
  const nearest = (pts: Point[], t: number): Point | null =>
    pts.length ? pts.reduce((b, p) => (Math.abs(p[0] - t) < Math.abs(b[0] - t) ? p : b), pts[0]) : null;
  const tfLabel = tf === "24H" ? "24 hours" : tf === "30D" ? "30 days" : "7 days";

  if (!hist)
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-3">
        <div className="mb-2 flex items-center justify-between text-[10px]">
          <span className="font-semibold text-slate-200">{tfLabel}</span>
          <div className="inline-flex rounded-lg border border-slate-800 bg-[#050811] p-0.5">
            {(["24H", "7D", "30D"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onTfChange(k)}
                className={`rounded-md px-2 py-0.5 font-mono font-bold cursor-pointer ${tf === k ? "bg-[#4C6FFF] text-white" : "text-slate-400 hover:text-white"}`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[190px] animate-pulse rounded-xl bg-slate-800/40" />
      </div>
    );
  const visibleNav = showNav || !showDex ? hist.nav : [];
  const visibleDex = showDex ? hist.dex : [];
  const all = [...visibleNav, ...visibleDex];
  if (all.length < 2)
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-3 space-y-2">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-semibold text-slate-200">{tfLabel}</span>
          <div className="inline-flex rounded-lg border border-slate-800 bg-[#050811] p-0.5">
            {(["24H", "7D", "30D"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onTfChange(k)}
                className={`rounded-md px-2 py-0.5 font-mono font-bold cursor-pointer ${tf === k ? "bg-[#4C6FFF] text-white" : "text-slate-400 hover:text-white"}`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-400">No price history available for {tf} yet.</p>
      </div>
    );
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
  const navAt = hoverT !== null ? nearest(hist.nav, hoverT) : null;
  const dexAt = hoverT !== null ? nearest(hist.dex, hoverT) : null;
  const scrubAt = (clientX: number, rect: DOMRect) => {
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    setHoverT(t0 + ratio * (t1 - t0));
  };
  const navSplit =
    tf !== "24H" && visibleNav.length > 1
      ? splitNavWeekendGaps(visibleNav)
      : { segments: visibleNav.length > 1 ? [visibleNav] : [], gaps: [] };
  const summary = summarizeSeries(hist.nav.length >= 2 ? hist.nav : hist.dex);
  const spotPrice = visibleNav.length ? visibleNav[visibleNav.length - 1][1] : visibleDex.length ? visibleDex[visibleDex.length - 1][1] : null;
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-3 sm:p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-200">{tfLabel}</span>
          <div className="inline-flex rounded-lg border border-slate-800 bg-[#050811] p-0.5">
            {(["24H", "7D", "30D"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setHoverT(null);
                  onTfChange(k);
                }}
                className={`rounded-md px-2 py-0.5 font-mono font-bold cursor-pointer ${tf === k ? "bg-[#4C6FFF] text-white" : "text-slate-400 hover:text-white"}`}
              >
                {k}
              </button>
            ))}
          </div>
          {summary && (
            <span className="flex flex-wrap items-center gap-1.5 font-mono tabular-nums text-[10px]">
              <span className="rounded border border-slate-800 bg-[#050811] px-1.5 py-0.5 text-slate-300">
                H <strong className="text-white">{usd(summary.high)}</strong> · L <strong className="text-white">{usd(summary.low)}</strong>
              </span>
              <span className={`rounded border px-1.5 py-0.5 font-bold ${summary.returnPct >= 0 ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : "border-rose-500/35 bg-rose-500/10 text-rose-300"}`}>
                {pct(summary.returnPct)}
              </span>
            </span>
          )}
        </div>
        <span className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
          {hoverT !== null && (
            <span className="text-cyan-200">
              {new Date(hoverT * 1000).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: tf === "30D" ? undefined : "2-digit",
                minute: tf === "24H" ? "2-digit" : undefined,
              })}
              {navAt ? ` · NAV ${usd(navAt[1])}` : ""}
              {dexAt ? ` · DEX ${usd(dexAt[1])}` : ""}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowNav((v) => (!v ? true : showDex ? false : true))}
            aria-pressed={showNav}
            className={`inline-flex items-center gap-1 font-sans cursor-pointer ${showNav ? "text-slate-200" : "text-slate-500 opacity-60"}`}
          >
            <span className="h-0.5 w-3" style={{ background: color }} /> Chainlink NAV
          </button>
          <button
            type="button"
            onClick={() => setShowDex((v) => (!v ? true : showNav ? false : true))}
            aria-pressed={showDex}
            className={`inline-flex items-center gap-1 font-sans cursor-pointer ${showDex ? "text-cyan-300" : "text-slate-500 opacity-60"}`}
          >
            <span className="h-0.5 w-3 bg-cyan-400" /> Base DEX
          </button>
          {navSplit.gaps.length > 0 && (
            <span className="inline-flex items-center gap-1 font-sans text-slate-400">
              <span className="h-2.5 w-2.5 rounded-sm border border-slate-400/40 bg-slate-400/20" /> NY closed
            </span>
          )}
        </span>
      </div>
      <div className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-[190px] w-full cursor-crosshair touch-pan-y"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${tfLabel} price chart`}
              onMouseMove={(e) => scrubAt(e.clientX, e.currentTarget.getBoundingClientRect())}
              onTouchStart={(e) => e.touches[0] && scrubAt(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
              onTouchMove={(e) => e.touches[0] && scrubAt(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
              onTouchEnd={() => setHoverT(null)}
              onTouchCancel={() => setHoverT(null)}
              onMouseLeave={() => setHoverT(null)}
            >
              {navSplit.gaps.map((g, idx) => {
                const gx0 = x(g.from[0]);
                const gx1 = x(g.to[0]);
                return (
                  <rect
                    key={`gap-${idx}-${g.from[0]}`}
                    x={gx0}
                    y={0}
                    width={Math.max(2, gx1 - gx0)}
                    height={H}
                    fill="rgba(148, 163, 184, 0.1)"
                  />
                );
              })}
              {navSplit.gaps.map((g, idx) => (
                <line
                  key={`bridge-${idx}-${g.from[0]}`}
                  x1={x(g.from[0])}
                  y1={y(g.from[1])}
                  x2={x(g.to[0])}
                  y2={y(g.to[1])}
                  stroke={color}
                  strokeOpacity="0.35"
                  strokeWidth="1.5"
                  strokeDasharray="3 4"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {navSplit.segments.map((seg, idx) =>
                seg.length > 1 ? (
                  <path
                    key={`nav-seg-${idx}-${seg[0][0]}`}
                    d={path(seg)}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : seg.length === 1 ? (
                  <circle key={`nav-pt-${idx}-${seg[0][0]}`} cx={x(seg[0][0])} cy={y(seg[0][1])} r="2.2" fill={color} />
                ) : null
              )}
              {spotPrice !== null && (
                <line x1={0} x2={W} y1={y(spotPrice)} y2={y(spotPrice)} stroke={color} strokeOpacity="0.35" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
              )}
              {visibleDex.length > 1 && <path d={path(visibleDex)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
              {marks.map(({ n, t }) => (
                <line key={`l${n.url}`} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke={KIND_DOT[kindOf(n)] ?? "#94a3b8"} strokeOpacity="0.25" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
              ))}
              {hoverT !== null && (
                <line x1={x(hoverT)} x2={x(hoverT)} y1={0} y2={H} stroke="rgba(148, 163, 184, 0.5)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            {/* Weekend closure labels rendered as HTML so preserveAspectRatio="none" never distorts text */}
            {navSplit.gaps.map((g, idx) => {
              const gx0 = x(g.from[0]);
              const gx1 = x(g.to[0]);
              const pctW = ((gx1 - gx0) / W) * 100;
              if (pctW < 7) return null;
              const centerLeft = (((gx0 + gx1) / 2) / W) * 100;
              return (
                <span
                  key={`gap-lbl-${idx}-${g.from[0]}`}
                  className="pointer-events-none absolute top-1.5 -translate-x-1/2 rounded px-1 py-0.5 font-mono text-[9px] text-slate-400"
                  style={{ left: `${centerLeft}%` }}
                >
                  NY closed
                </span>
              );
            })}
            {/* News dots: HTML on top of the SVG so they stay round; staggered to avoid collisions */}
            {(() => {
              const placed: number[] = [];
              return marks.map(({ n, t }) => {
                const left = (x(t) / W) * 100;
                const top = Math.max(8, Math.min(92, (y(priceAt(t)) / H) * 100));
                const closeCount = placed.filter((prevL) => Math.abs(prevL - left) < 5).length;
                placed.push(left);
                const dy = closeCount === 0 ? 0 : closeCount % 2 === 1 ? -11 * Math.ceil(closeCount / 2) : 11 * Math.ceil(closeCount / 2);
                const k = kindOf(n);
                const horiz = left > 72 ? "right-0" : left < 28 ? "left-0" : "left-1/2 -translate-x-1/2";
                const vert = top < 35 ? "top-4" : "bottom-4";
                return (
                  <a
                    key={n.url}
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group absolute -translate-x-1/2 -translate-y-1/2 hover:z-20"
                    style={{ left: `${left}%`, top: `calc(${top}% + ${dy}px)` }}
                    aria-label={`${KIND_LABEL[k] ?? "News"}: ${n.title}`}
                  >
                    <span className="block h-3 w-3 rounded-full border-2 border-[#0b1120] shadow" style={{ background: KIND_DOT[k] ?? "#94a3b8" }} />
                    <span
                      className={`pointer-events-none absolute z-20 hidden w-48 sm:w-56 rounded-lg border border-slate-700 bg-[#050811] p-2 text-[10px] leading-snug text-slate-300 shadow-xl group-hover:block group-focus:block ${horiz} ${vert}`}
                    >
                      <span className="block font-bold text-white">{n.title}</span>
                      <span className="mt-0.5 block text-slate-500">
                        {KIND_LABEL[k] ?? "News"} · {new Date(n.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}
                        {n.changePct !== null ? ` · ${n.changePct >= 0 ? "+" : ""}${n.changePct.toFixed(2)}% since` : ""}
                      </span>
                    </span>
                  </a>
                );
              });
            })()}
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono tabular-nums text-[10px] text-slate-400">
        <span>{usd(lo)}</span>
        <span className="hidden sm:inline text-slate-500">
          {new Date(t0 * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })} →{" "}
          {new Date(((t0 + t1) / 2) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })} →{" "}
          {new Date(t1 * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
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
            ? "enforced onchain via Base B20 issuer compliance hooks (Reg S / eligible non-US holders)."
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
