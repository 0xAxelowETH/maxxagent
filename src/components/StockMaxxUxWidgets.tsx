"use client";

import { MarketStatus } from "./MarketStatus";
import { splitNavWeekendGaps, usMarketStatus } from "@/lib/marketHours";
import { summarizeSeries, toPctSeries } from "@/lib/chartMetrics";
import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  Calculator,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitCompareArrows,
  HelpCircle,
  Newspaper,
  RotateCcw,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { BASE_TOKENIZED_STOCKS, LiveTokenizedStock, MIN_BUY_USD, TokenizedStockMetadata } from "@/lib/tokenizedStocks";

interface GuidedQuickStartBarProps {
  setActiveTab: (tab: "terminal" | "agent" | "indexes" | "traction" | "public") => void;
  onQuickRunAgent: () => void;
}

const QUICKSTART_DISMISS_KEY = "maxxagent_quickstart_hidden";

/**
 * 1. Compact 1-Line Dismissible Quick-Start Strip (keeps Hero & Agent input above the fold)
 */
export function GuidedQuickStartBar({
  setActiveTab,
  onQuickRunAgent,
}: GuidedQuickStartBarProps) {
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(QUICKSTART_DISMISS_KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  if (hidden !== false) return null;

  return (
    <div className="hero-mesh-card rounded-2xl px-3 py-2 sm:px-4 sm:py-2.5 flex flex-wrap items-center justify-between gap-2 animate-fade-up">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] sm:text-xs min-w-0">
        <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 border border-cyan-500/35 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300 shrink-0">
          <Sparkles className="h-3 w-3 text-cyan-400" />
          Quick start
        </span>
        <span className="sm:hidden font-medium text-slate-200 truncate">
          1. Explore · 2. Ask Agent · 3. Sign
        </span>
        <span className="hidden sm:inline-flex items-center gap-1 text-slate-200 font-semibold">
          <span>1. Explore 10 live stocks</span>
        </span>
        <span className="hidden sm:inline text-slate-500" aria-hidden="true">·</span>
        <span className="hidden sm:inline text-slate-300">2. Ask Agent for a basket</span>
        <span className="hidden md:inline text-slate-500" aria-hidden="true">·</span>
        <span className="hidden md:inline text-slate-300">3. Review &amp; sign in your own wallet</span>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
        <button
          type="button"
          onClick={() => {
            setActiveTab("agent");
            onQuickRunAgent();
          }}
          className="inline-flex min-h-[32px] sm:min-h-[34px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#4C6FFF] to-cyan-600 hover:brightness-110 px-2.5 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold text-white shadow-md shadow-[#4C6FFF]/25 transition cursor-pointer"
        >
          <Bot className="h-3.5 w-3.5" />
          Run Agent
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            try {
              window.localStorage.setItem(QUICKSTART_DISMISS_KEY, "1");
            } catch {
              // ignore storage issues
            }
          }}
          aria-label="Dismiss quick start"
          title="Dismiss"
          className="inline-flex min-h-[32px] min-w-[32px] sm:min-h-[34px] sm:min-w-[34px] items-center justify-center rounded-xl border border-slate-700/80 bg-[#050a16] text-slate-400 hover:text-white hover:border-slate-500 transition cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * 2. Price chart with REAL history: Chainlink total-return rounds (onchain, 24/5) vs DEX closes (24/7).
 *    Data comes from /api/history; nothing is synthesized. If a source is unavailable, it is shown as such.
 */
type HistoryTf = "24H" | "7D" | "30D";
interface HistoryResponse {
  ok: boolean;
  nav: [number, number][];
  dex: [number, number][];
  dexPool: string | null;
}
interface NewsPin {
  symbol: string;
  kind: "news" | "filing" | "newsroom";
  title: string;
  url: string;
  publishedAt: string;
  pressRelease?: boolean;
  changePct: number | null;
}

const PIN_COLOR: Record<string, string> = {
  press: "#34d399",
  newsroom: "#a5b4fc",
  filing: "#94a3b8",
  news: "#38bdf8",
};
const pinKind = (n: NewsPin) => (n.kind === "filing" ? (n.pressRelease ? "press" : "filing") : n.kind);
const PIN_LABEL: Record<string, string> = {
  press: "Press release",
  newsroom: "Company news",
  filing: "SEC filing",
  news: "Headline",
};

// Client-side history cache shared by every chart instance: switching back to a stock is instant
const HISTORY_TTL_MS = 5 * 60 * 1000;
const historyCache = new Map<string, { at: number; data: HistoryResponse | null }>();
const inflight = new Map<string, Promise<void>>();
let newsCache: { at: number; items: NewsPin[] } | null = null;
let newsInflight: Promise<NewsPin[]> | null = null;

function loadNewsPins(): Promise<NewsPin[]> {
  if (newsCache && Date.now() - newsCache.at < HISTORY_TTL_MS) return Promise.resolve(newsCache.items);
  if (newsInflight) return newsInflight;
  newsInflight = fetch("/api/news")
    .then((r) => r.json())
    .then((d) => {
      if (d?.ok && Array.isArray(d.items)) {
        newsCache = { at: Date.now(), items: d.items };
        return d.items as NewsPin[];
      }
      return newsCache?.items ?? [];
    })
    .catch(() => newsCache?.items ?? [])
    .finally(() => {
      newsInflight = null;
    });
  return newsInflight;
}

function loadHistory(symbol: string, tf: HistoryTf, force = false): Promise<void> {
  const key = `${symbol}:${tf}`;
  const hit = historyCache.get(key);
  if (!force && hit && Date.now() - hit.at < HISTORY_TTL_MS) return Promise.resolve();
  const running = inflight.get(key);
  if (running) return running;
  const p = fetch(`/api/history?symbol=${symbol}&tf=${tf}`)
    .then((r) => r.json())
    .then((d: HistoryResponse) => {
      // keep a previous good series if a refresh fails; never pin an error/429 for 5 minutes
      if (d?.ok) historyCache.set(key, { at: Date.now(), data: d });
      else if (!hit) historyCache.set(key, { at: Date.now() - HISTORY_TTL_MS + 15_000, data: null });
    })
    .catch(() => {
      if (!hit) historyCache.set(key, { at: Date.now() - HISTORY_TTL_MS + 30_000, data: null }); // retry in 30s
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function nearest(series: [number, number][], t: number): [number, number] | null {
  if (series.length === 0) return null;
  let best = series[0];
  for (const p of series) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
  return best;
}

function interpAt(pts: [number, number][], t: number): number | null {
  if (pts.length === 0) return null;
  if (t <= pts[0][0]) return pts[0][1];
  if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] >= t) {
      const [t0, v0] = pts[i - 1];
      const [t1, v1] = pts[i];
      const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      return v0 + (v1 - v0) * frac;
    }
  }
  return pts[pts.length - 1][1];
}

export function InteractiveB20TradingChart({
  stocks,
  selectedSymbol,
  onSelectSymbol,
  onSendToAgent,
  onBuy,
  onSell,
  tradeUsd,
  onTradeUsdChange,
  usdcBalance,
  ethBalance,
  ethUsd,
  holdingTokens,
  avgCostUsd = null,
  tradeMarkers = [],
  walletConnected,
  pending,
  pendingLabel,
}: {
  stocks: LiveTokenizedStock[];
  selectedSymbol: string;
  onSelectSymbol: (sym: string) => void;
  onSendToAgent: (sym: string) => void;
  /** Buy `usd` worth of the stock with USDC */
  onBuy: (stock: TokenizedStockMetadata, usd: number, payWith: "usdc" | "eth") => void;
  /** Sell `tokens` of the stock for USDC */
  onSell: (stock: TokenizedStockMetadata, tokens: number) => void;
  tradeUsd: number;
  onTradeUsdChange: (usd: number) => void;
  usdcBalance: number | null;
  ethBalance: number | null;
  ethUsd: number | null;
  /** Wallet balance of the selected stock, in stock tokens */
  holdingTokens: number;
  avgCostUsd?: number | null;
  tradeMarkers?: { time: number; side: "buy" | "sell"; usd: number }[];
  walletConnected: boolean;
  pending: boolean;
  pendingLabel: string;
}) {
  const [timeframe, setTimeframe] = useState<HistoryTf>("7D");
  const [unitMode, setUnitMode] = useState<"usd" | "pct">("usd");
  const [showNav, setShowNav] = useState<boolean>(true);
  const [showDex, setShowDex] = useState<boolean>(true);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [hoverSpread, setHoverSpread] = useState<{ t: number; pct: number } | null>(null);
  const [peerSymbol, setPeerSymbol] = useState<string>("");

  useEffect(() => {
    setHoverT(null);
    setHoverSpread(null);
  }, [selectedSymbol, timeframe]);
  const [showPins, setShowPins] = useState<boolean>(true);
  const [allNews, setAllNews] = useState<NewsPin[]>([]);
  // Bumped when a history response lands, so the chart re-reads the cache
  const [, setCacheTick] = useState(0);

  const stockList: TokenizedStockMetadata[] = stocks.length > 0 ? stocks : BASE_TOKENIZED_STOCKS;
  const activeStock = stockList.find((s) => s.symbol === selectedSymbol) || stockList[0];
  const liveActive = "navPrice" in activeStock ? (activeStock as LiveTokenizedStock) : null;
  const peerStock = peerSymbol && peerSymbol !== activeStock.symbol ? stockList.find((s) => s.symbol === peerSymbol) ?? null : null;

  const key = `${activeStock.symbol}:${timeframe}`;
  // Only the history of the stock on screen is ever used: never the previous stock's series
  const cachedEntry = historyCache.get(key);
  const history = cachedEntry?.data ?? null;
  const loading = !cachedEntry || Date.now() - cachedEntry.at > HISTORY_TTL_MS;
  const peerHistory = peerStock ? historyCache.get(`${peerStock.symbol}:${timeframe}`)?.data ?? null : null;

  useEffect(() => {
    let cancelled = false;
    loadHistory(activeStock.symbol, timeframe).finally(() => {
      if (!cancelled) setCacheTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [activeStock.symbol, timeframe]);

  useEffect(() => {
    if (!peerStock) return;
    let cancelled = false;
    loadHistory(peerStock.symbol, timeframe).finally(() => {
      if (!cancelled) setCacheTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [peerStock, timeframe]);

  useEffect(() => {
    if (!showPins) return;
    let cancelled = false;
    loadNewsPins().then((items) => {
      if (!cancelled) setAllNews(items);
    });
    return () => {
      cancelled = true;
    };
  }, [showPins]);

  // Warm the cache for the other stocks in the background (one at a time, gently)
  const symbolsKey = stockList.map((s) => s.symbol).join(",");
  useEffect(() => {
    let stop = false;
    const timer = setTimeout(async () => {
      for (const sym of symbolsKey.split(",")) {
        if (stop) return;
        if (historyCache.has(`${sym}:${timeframe}`)) continue;
        await loadHistory(sym, timeframe);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }, 2500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [symbolsKey, timeframe]);

  const navRaw = useMemo(() => [...(history?.nav ?? [])].sort((a, b) => a[0] - b[0]), [history]);
  const dexRaw = useMemo(() => [...(history?.dex ?? [])].sort((a, b) => a[0] - b[0]), [history]);
  const peerNavRaw = useMemo(() => [...(peerHistory?.nav ?? [])].sort((a, b) => a[0] - b[0]), [peerHistory]);

  const isPctMode = Boolean(peerStock) || unitMode === "pct";
  const nav = useMemo(() => (isPctMode ? toPctSeries(navRaw) : navRaw), [isPctMode, navRaw]);
  const peerSeries = useMemo(() => (peerStock ? toPctSeries(peerNavRaw) : []), [peerStock, peerNavRaw]);
  const dex = useMemo(() => (peerStock ? [] : isPctMode ? toPctSeries(dexRaw) : dexRaw), [peerStock, isPctMode, dexRaw]);

  const visibleNav = useMemo(() => (showNav || !showDex ? nav : []), [showNav, showDex, nav]);
  const visibleDex = useMemo(() => (showDex ? dex : []), [showDex, dex]);
  const all = [...visibleNav, ...visibleDex, ...peerSeries];
  const hasData = all.length >= 2;
  const periodSummary = useMemo(() => summarizeSeries(navRaw.length >= 2 ? navRaw : dexRaw), [navRaw, dexRaw]);
  const isMarketClosed = usMarketStatus().state !== "open";

  const svgWidth = 760;
  const svgHeight = 312;
  const padL = 14;
  const padR = 58;
  const padT = 18;
  const padB = 26;
  const plotW = svgWidth - padL - padR;
  const plotH = svgHeight - padT - padB;

  const tMin = hasData ? Math.min(...all.map((p) => p[0])) : 0;
  const tMax = hasData ? Math.max(...all.map((p) => p[0])) : 1;
  const rawMin = hasData ? Math.min(...all.map((p) => p[1])) : 0;
  const rawMax = hasData ? Math.max(...all.map((p) => p[1])) : 1;
  const span = Math.max(isPctMode ? 0.5 : 0.01, rawMax - rawMin);
  const vMin = isPctMode ? rawMin - span * 0.1 : rawMin * 0.998;
  const vMax = isPctMode ? rawMax + span * 0.1 : rawMax * 1.002;
  const x = (t: number) => padL + ((t - tMin) / Math.max(1, tMax - tMin)) * plotW;
  const y = (v: number) => padT + plotH - ((v - vMin) / Math.max(1e-9, vMax - vMin)) * plotH;
  const toPoints = (s: [number, number][]) => s.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const dexPointsStr = toPoints(visibleDex);
  const peerPointsStr = toPoints(peerSeries);

  const cursorT = hoverT ?? tMax;
  const navAt = nearest(visibleNav, cursorT);
  const dexAt = nearest(visibleDex, cursorT);
  const navUsdAt = nearest(navRaw, cursorT);
  const dexUsdAt = nearest(dexRaw, cursorT);
  const peerAt = peerStock ? nearest(peerSeries, cursorT) : null;
  const displayedNav = hoverT !== null ? (navUsdAt ? navUsdAt[1] : liveActive?.navPrice ?? 0) : liveActive?.navPrice ?? (navUsdAt ? navUsdAt[1] : 0);
  const displayedDex = hoverT !== null ? (dexUsdAt ? dexUsdAt[1] : liveActive?.dexPrice24_7 ?? 0) : liveActive?.dexPrice24_7 ?? (dexUsdAt ? dexUsdAt[1] : 0);
  const gapAtCursor =
    hoverT === null && liveActive && typeof liveActive.weekendGapPct === "number"
      ? liveActive.weekendGapPct
      : displayedNav > 0 && displayedDex > 0
      ? ((displayedDex - displayedNav) / displayedNav) * 100
      : 0;
  const change24h = liveActive?.change24hPct ?? 0;
  const uiMultiplier = liveActive ? liveActive.uiMultiplier : activeStock.defaultMultiplier;
  const liquidityUsd = liveActive?.dexLiquidityUsd;
  const volume24hUsd = liveActive?.dexVolume24hUsd;
  const visibleTrades = useMemo(
    () => (peerStock || !hasData ? [] : tradeMarkers.filter((m) => m.time >= tMin && m.time <= tMax).slice(0, 16)),
    [peerStock, hasData, tradeMarkers, tMin, tMax]
  );
  const spotVal = !peerStock && hasData ? (visibleNav.length ? visibleNav[visibleNav.length - 1][1] : visibleDex.length ? visibleDex[visibleDex.length - 1][1] : null) : null;

  // Historical DEX vs NAV spread histogram across overlapping window
  const spreadBars = useMemo(() => {
    if (peerStock || navRaw.length < 2 || dexRaw.length < 2) return [];
    const sStart = Math.max(navRaw[0][0], dexRaw[0][0]);
    const sEnd = Math.min(navRaw[navRaw.length - 1][0], dexRaw[dexRaw.length - 1][0]);
    if (!(sEnd > sStart)) return [];
    const count = 42;
    const out: { t: number; pct: number }[] = [];
    for (let i = 0; i < count; i++) {
      const ts = sStart + (i / (count - 1)) * (sEnd - sStart);
      const nv = interpAt(navRaw, ts);
      const dx = interpAt(dexRaw, ts);
      if (nv && dx && nv > 0) out.push({ t: ts, pct: ((dx - nv) / nv) * 100 });
    }
    return out;
  }, [peerStock, navRaw, dexRaw]);

  const navSplit = useMemo(
    () =>
      !peerStock && timeframe !== "24H" && visibleNav.length >= 2
        ? splitNavWeekendGaps(visibleNav)
        : { segments: visibleNav.length >= 2 ? [visibleNav] : [], gaps: [] },
    [peerStock, timeframe, visibleNav]
  );

  const spreadAmp = spreadBars.length > 0 ? Math.max(0.5, ...spreadBars.map((b) => Math.abs(b.pct))) : 1;

  // News / SEC pin markers along primary curve
  const pinLine = dexRaw.length >= 2 ? dexRaw : navRaw;
  const newsMarks = useMemo(() => {
    if (!showPins || peerStock || !hasData || pinLine.length < 2) return [];
    return allNews
      .filter((n) => n.symbol === activeStock.symbol)
      .map((n) => ({ n, t: Date.parse(n.publishedAt) / 1000 }))
      .filter(({ t }) => Number.isFinite(t) && t >= tMin && t <= tMax)
      .sort((a, b) => Number(a.n.kind === "news") - Number(b.n.kind === "news"))
      .slice(0, 12);
  }, [showPins, peerStock, hasData, pinLine.length, allNews, activeStock.symbol, tMin, tMax]);

  const scrub = (clientX: number, rect: DOMRect) => {
    if (!hasData || rect.width <= 0) return;
    const px = ((clientX - rect.left) / rect.width) * svgWidth;
    const ratio = Math.min(1, Math.max(0, (px - padL) / plotW));
    setHoverT(tMin + ratio * (tMax - tMin));
  };

  const fmtTime = (t: number) =>
    new Date(t * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: timeframe === "30D" ? undefined : "2-digit",
      minute: timeframe === "24H" ? "2-digit" : undefined,
    });

  const fmtAxis = (v: number) => (isPctMode ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : `$${v >= 1000 ? v.toFixed(0) : v.toFixed(2)}`);
  const cursorLeftPct = hasData ? (x(cursorT) / svgWidth) * 100 : 50;
  const gaugePosPct = 50 + Math.max(-1, Math.min(1, gapAtCursor / 2)) * 50;

  return (
    <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-5 animate-fade-up">
      {/* Stock selector + Compare Peer + Pin toggle + Timeframe */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {stockList.map((st) => {
            const isSel = st.symbol === activeStock.symbol;
            return (
              <button
                key={st.symbol}
                onClick={() => {
                  if (peerSymbol === st.symbol) setPeerSymbol("");
                  onSelectSymbol(st.symbol);
                }}
                className={`inline-flex min-h-[36px] shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-mono font-bold transition-all cursor-pointer border ${
                  isSel
                    ? "bg-[#4C6FFF] text-white border-blue-400 shadow-lg shadow-[#4C6FFF]/30 scale-[1.02]"
                    : "bg-[#050a18] text-slate-300 border-slate-800 hover:border-slate-600 hover:text-white"
                }`}
              >
                <img src={st.logoUrl} alt={st.symbol} className="h-4 w-4 rounded-full object-cover bg-slate-900" />
                <span>{st.symbol}</span>
              </button>
            );
          })}
        </div>

        {/* Full width on phones so the controls wrap inside the card instead of running past its edge */}
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          <label className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-[#040814] px-2.5 py-1 text-[11px] text-slate-300">
            <GitCompareArrows className="h-3.5 w-3.5 text-cyan-400" />
            <select
              aria-label="Compare peer stock"
              value={peerStock ? peerStock.symbol : ""}
              onChange={(e) => {
                setPeerSymbol(e.target.value);
                setHoverT(null);
              }}
              className="bg-transparent font-mono text-[11px] font-bold text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="" className="bg-[#040814]">vs DEX (USD)</option>
              {stockList
                .filter((st) => st.symbol !== activeStock.symbol)
                .map((st) => (
                  <option key={st.symbol} value={st.symbol} className="bg-[#040814]">
                    Compare {st.symbol}
                  </option>
                ))}
            </select>
          </label>

          {!peerStock && (
            <div className="inline-flex rounded-xl border border-slate-800 bg-[#040814] p-0.5">
              {(["usd", "pct"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setUnitMode(m)}
                  aria-pressed={unitMode === m}
                  title={m === "usd" ? "Show price in USD" : "Show % return across selected timeframe"}
                  className={`min-h-[30px] rounded-lg px-2 py-1 font-mono text-[11px] font-bold transition cursor-pointer ${
                    unitMode === m ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {m === "usd" ? "$" : "%"}
                </button>
              ))}
            </div>
          )}

          {!peerStock && (
            <button
              type="button"
              onClick={() => setShowPins((p) => !p)}
              aria-pressed={showPins}
              title="Toggle press releases and SEC filings on chart"
              className={`inline-flex min-h-[32px] items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                showPins
                  ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-200"
                  : "border-slate-800 bg-[#040814] text-slate-400 hover:text-white"
              }`}
            >
              <Newspaper className="h-3 w-3" />
              Pins
            </button>
          )}

          <div className="inline-flex rounded-xl border border-slate-800 bg-[#040814] p-0.5">
            {(["24H", "7D", "30D"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => {
                  setTimeframe(tf);
                  setHoverT(null);
                }}
                className={`min-h-[30px] rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold transition cursor-pointer ${
                  timeframe === tf ? "bg-[#4C6FFF] text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-8 lg:self-start flex flex-col rounded-2xl border border-slate-800/90 bg-[#040814]/90 p-4 sm:p-5 relative">
          <div className="flex flex-wrap items-start justify-between gap-4 z-10">
            <div className="flex items-center gap-3.5">
              <img
                src={activeStock.logoUrl}
                alt={activeStock.companyName}
                className="h-12 w-12 rounded-2xl border border-slate-700 bg-slate-900 object-cover shadow-lg shrink-0"
              />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-extrabold text-white">{activeStock.companyName}</h3>
                  <span
                    className="rounded-md px-2 py-0.5 font-mono text-xs font-bold text-white"
                    style={{ backgroundColor: activeStock.color, textShadow: "0 1px 2px rgba(0, 0, 0, 0.55)" }}
                  >
                    {activeStock.symbol}
                  </span>
                  <span className="rounded-md bg-slate-800/90 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                    ISIN: {activeStock.isin}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{activeStock.description}</p>
              </div>
            </div>

            {peerStock ? (
              <div className="text-right font-mono tabular-nums">
                <div className="text-sm font-extrabold text-white">
                  {activeStock.symbol}{" "}
                  <span className={(navAt?.[1] ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}>
                    {(navAt?.[1] ?? 0) >= 0 ? "+" : ""}
                    {(navAt?.[1] ?? 0).toFixed(2)}%
                  </span>
                </div>
                <div className="text-xs text-pink-300 mt-0.5">
                  {peerStock.symbol}:{" "}
                  <strong>
                    {(peerAt?.[1] ?? 0) >= 0 ? "+" : ""}
                    {(peerAt?.[1] ?? 0).toFixed(2)}%
                  </strong>
                </div>
              </div>
            ) : (
              <div className="text-right font-mono tabular-nums">
                <div className="flex items-center justify-end gap-2">
                  {/* "…" until live data lands, instead of a $0.00 price that looks real */}
                  <span className="text-2xl font-extrabold text-white">{displayedNav > 0 ? `$${displayedNav.toFixed(2)}` : "…"}</span>
                  {hoverT === null && liveActive && (
                    <span
                      className={`rounded-lg px-2 py-0.5 text-xs font-bold ${
                        change24h >= 0
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/35"
                          : "bg-rose-500/20 text-rose-300 border border-rose-500/35"
                      }`}
                      title="24h DEX price change"
                    >
                      {change24h >= 0 ? "+" : ""}
                      {change24h.toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-cyan-300 mt-0.5">
                  {displayedDex > 0 && displayedNav > 0 ? (
                    <>
                      DEX: <strong>${displayedDex.toFixed(2)}</strong> ({gapAtCursor >= 0 ? "+" : ""}
                      {gapAtCursor.toFixed(2)}% vs NAV)
                    </>
                  ) : (
                    "DEX: …"
                  )}
                </div>
              </div>
            )}
          </div>

          {!peerStock && hasData && (periodSummary || (avgCostUsd !== null && avgCostUsd > 0)) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] font-mono tabular-nums">
              {periodSummary && (
                <>
                  <span className="rounded-lg border border-slate-800 bg-[#050a18] px-2 py-0.5 text-slate-300">
                    {timeframe} High <strong className="text-white">${periodSummary.high.toFixed(2)}</strong>
                  </span>
                  <span className="rounded-lg border border-slate-800 bg-[#050a18] px-2 py-0.5 text-slate-300">
                    Low <strong className="text-white">${periodSummary.low.toFixed(2)}</strong>
                  </span>
                  <span
                    className={`rounded-lg border px-2 py-0.5 font-bold ${
                      periodSummary.returnPct >= 0
                        ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                        : "border-rose-500/35 bg-rose-500/10 text-rose-300"
                    }`}
                  >
                    {timeframe} {periodSummary.returnPct >= 0 ? "+" : ""}{periodSummary.returnPct.toFixed(2)}%
                  </span>
                </>
              )}
              {avgCostUsd !== null && avgCostUsd > 0 && displayedNav > 0 && (
                <span className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-amber-200">
                  Your Avg <strong>${avgCostUsd.toFixed(2)}</strong>{" "}
                  ({displayedNav >= avgCostUsd ? "+" : ""}
                  {(((displayedNav - avgCostUsd) / avgCostUsd) * 100).toFixed(1)}%)
                </span>
              )}
            </div>
          )}

          <div className="my-3 relative select-none">
            {hasData ? (
              <>
                <div className="relative">
                  <svg
                    viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                    className="w-full h-auto overflow-visible cursor-crosshair touch-pan-y"
                    onMouseMove={(e) => scrub(e.clientX, e.currentTarget.getBoundingClientRect())}
                    onTouchStart={(e) => e.touches[0] && scrub(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
                    onTouchMove={(e) => e.touches[0] && scrub(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
                    onTouchEnd={() => setHoverT(null)}
                    onTouchCancel={() => setHoverT(null)}
                    onMouseLeave={() => setHoverT(null)}
                  >
                    <defs>
                      <linearGradient id="chart-nav-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={activeStock.color} stopOpacity="0.32" />
                        <stop offset="100%" stopColor={activeStock.color} stopOpacity="0" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal gridlines + Y-axis labels */}
                    {[0, 0.5, 1].map((ratio) => {
                      const val = vMax - (vMax - vMin) * ratio;
                      const gy = padT + plotH * ratio;
                      return (
                        <g key={ratio}>
                          <line
                            x1={padL}
                            x2={svgWidth - padR}
                            y1={gy}
                            y2={gy}
                            stroke="rgba(51, 65, 85, 0.35)"
                            strokeDasharray="4 4"
                          />
                          <text
                            x={svgWidth - 4}
                            y={gy + 3}
                            textAnchor="end"
                            fill="rgba(148, 163, 184, 0.85)"
                            fontSize="10"
                            fontFamily="ui-monospace, SFMono-Regular, monospace"
                          >
                            {fmtAxis(val)}
                          </text>
                        </g>
                      );
                    })}

                    {/* Zero baseline when viewing % change */}
                    {isPctMode && vMin <= 0 && vMax >= 0 && (
                      <line
                        x1={padL}
                        x2={svgWidth - padR}
                        y1={y(0)}
                        y2={y(0)}
                        stroke="rgba(148, 163, 184, 0.5)"
                        strokeDasharray="2 3"
                      />
                    )}

                    {/* Spot price horizontal guide + right-axis pill */}
                    {spotVal !== null && spotVal >= vMin && spotVal <= vMax && (
                      <g>
                        <line
                          x1={padL}
                          x2={svgWidth - padR}
                          y1={y(spotVal)}
                          y2={y(spotVal)}
                          stroke={activeStock.color}
                          strokeOpacity="0.45"
                          strokeDasharray="2 3"
                        />
                        <rect
                          x={svgWidth - padR + 4}
                          y={y(spotVal) - 8}
                          width={padR - 6}
                          height={16}
                          rx={4}
                          fill={activeStock.color}
                        />
                        <text
                          x={svgWidth - 5}
                          y={y(spotVal) + 3}
                          textAnchor="end"
                          fill="#ffffff"
                          fontSize="9.5"
                          fontWeight="700"
                          fontFamily="ui-monospace, SFMono-Regular, monospace"
                        >
                          {fmtAxis(spotVal)}
                        </text>
                      </g>
                    )}

                    {/* Connected wallet average cost line (USD mode) */}
                    {!isPctMode && avgCostUsd !== null && avgCostUsd > 0 && avgCostUsd >= vMin && avgCostUsd <= vMax && (
                      <g>
                        <line
                          x1={padL}
                          x2={svgWidth - padR}
                          y1={y(avgCostUsd)}
                          y2={y(avgCostUsd)}
                          stroke="#fbbf24"
                          strokeOpacity="0.85"
                          strokeWidth="1.4"
                          strokeDasharray="4 3"
                        />
                        <rect x={padL + 2} y={y(avgCostUsd) - 15} width={86} height={13} rx={3} fill="rgba(245, 158, 11, 0.2)" stroke="rgba(251, 191, 36, 0.55)" />
                        <text x={padL + 6} y={y(avgCostUsd) - 6} fill="#fde68a" fontSize="8.5" fontWeight="700" fontFamily="ui-monospace, monospace">
                          {`Avg $${avgCostUsd.toFixed(2)}`}
                        </text>
                      </g>
                    )}

                    {/* Bottom X-axis time ticks */}
                    {[0, 0.5, 1].map((ratio) => {
                      const ts = tMin + (tMax - tMin) * ratio;
                      return (
                        <text
                          key={ratio}
                          x={padL + plotW * ratio}
                          y={svgHeight - 6}
                          textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"}
                          fill="rgba(148, 163, 184, 0.75)"
                          fontSize="9.5"
                          fontFamily="ui-monospace, SFMono-Regular, monospace"
                        >
                          {fmtTime(ts)}
                        </text>
                      );
                    })}

                    {navSplit.gaps.map((g, idx) => {
                      const gx0 = x(g.from[0]);
                      const gx1 = x(g.to[0]);
                      const gw = Math.max(4, gx1 - gx0);
                      return (
                        <g key={`gap-${idx}-${g.from[0]}`}>
                          <rect x={gx0} y={padT} width={gw} height={plotH} fill="rgba(148, 163, 184, 0.1)" rx="2" />
                          {gw >= 44 && (
                            <text
                              x={(gx0 + gx1) / 2}
                              y={padT + 11}
                              textAnchor="middle"
                              fill="rgba(148, 163, 184, 0.8)"
                              fontSize="8.5"
                              fontFamily="ui-monospace, SFMono-Regular, monospace"
                            >
                              NY closed
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {!peerStock &&
                      navSplit.segments.map((seg, idx) =>
                        seg.length >= 2 ? (
                          <polygon
                            key={`area-${idx}-${seg[0][0]}`}
                            points={`${x(seg[0][0])},${padT + plotH} ${toPoints(seg)} ${x(seg[seg.length - 1][0])},${padT + plotH}`}
                            fill="url(#chart-nav-fill)"
                          />
                        ) : null
                      )}
                    {visibleDex.length >= 2 && (
                      <polyline
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth="2"
                        strokeDasharray="5 4"
                        points={dexPointsStr}
                        opacity="0.9"
                      />
                    )}
                    {peerSeries.length >= 2 && (
                      <polyline
                        fill="none"
                        stroke="#f472b6"
                        strokeWidth="2.2"
                        strokeDasharray="5 3"
                        points={peerPointsStr}
                      />
                    )}
                    {navSplit.gaps.map((g, idx) => (
                      <line
                        key={`bridge-${idx}-${g.from[0]}`}
                        x1={x(g.from[0])}
                        y1={y(g.from[1])}
                        x2={x(g.to[0])}
                        y2={y(g.to[1])}
                        stroke={activeStock.color}
                        strokeOpacity="0.35"
                        strokeWidth="1.5"
                        strokeDasharray="3 4"
                      />
                    ))}
                    {navSplit.segments.map((seg, idx) =>
                      seg.length >= 2 ? (
                        <polyline
                          key={`nav-seg-${idx}-${seg[0][0]}`}
                          fill="none"
                          stroke={activeStock.color}
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={toPoints(seg)}
                        />
                      ) : seg.length === 1 && navSplit.gaps.length > 0 ? (
                        <circle key={`nav-pt-${idx}-${seg[0][0]}`} cx={x(seg[0][0])} cy={y(seg[0][1])} r="3" fill={activeStock.color} />
                      ) : null
                    )}
                    {newsMarks.map(({ n, t }) => (
                      <line
                        key={`pl-${n.url}`}
                        x1={x(t)}
                        x2={x(t)}
                        y1={padT}
                        y2={padT + plotH}
                        stroke={PIN_COLOR[pinKind(n)] ?? "#94a3b8"}
                        strokeOpacity="0.28"
                        strokeDasharray="2 3"
                      />
                    ))}
                    {hoverT !== null && (
                      <line
                        x1={x(hoverT)}
                        x2={x(hoverT)}
                        y1={padT}
                        y2={padT + plotH}
                        stroke="rgba(148, 163, 184, 0.55)"
                        strokeDasharray="3 3"
                      />
                    )}
                    {navAt && (
                      <circle cx={x(navAt[0])} cy={y(navAt[1])} r="5" fill={activeStock.color} stroke="#fff" strokeWidth="2" />
                    )}
                    {dexAt && <circle cx={x(dexAt[0])} cy={y(dexAt[1])} r="4" fill="#22d3ee" stroke="#fff" strokeWidth="1.5" />}
                    {peerAt && <circle cx={x(peerAt[0])} cy={y(peerAt[1])} r="4.5" fill="#f472b6" stroke="#fff" strokeWidth="1.5" />}
                    {visibleTrades.map((m, i) => {
                      const baseLine = visibleNav.length >= 2 ? visibleNav : visibleDex;
                      const vy = interpAt(baseLine, m.time);
                      if (vy === null) return null;
                      const cx = x(m.time);
                      const cy = y(vy);
                      const isBuy = m.side === "buy";
                      return (
                        <g key={`tr-${m.time}-${i}`}>
                          <circle cx={cx} cy={cy} r={8} fill={isBuy ? "#10b981" : "#f43f5e"} stroke="#040814" strokeWidth={1.5}>
                            <title>{`${isBuy ? "BUY" : "SELL"} $${m.usd.toFixed(2)} (${fmtTime(m.time)})`}</title>
                          </circle>
                          <text x={cx} y={cy + 3} textAnchor="middle" fill="#ffffff" fontSize="8.5" fontWeight="800" fontFamily="ui-monospace, monospace">
                            {isBuy ? "B" : "S"}
                          </text>
                        </g>
                      );
                    })}
                  </svg>

                  {/* Interactive news/SEC pin dots (staggered to avoid overlaps, clamped tooltips) */}
                  {(() => {
                    const placed: number[] = [];
                    return newsMarks.map(({ n, t }) => {
                      const pVal = interpAt(pinLine, t);
                      if (pVal === null) return null;
                      const left = (x(t) / svgWidth) * 100;
                      const top = Math.max(8, Math.min(92, (y(pVal) / svgHeight) * 100));
                      const closeCount = placed.filter((prevL) => Math.abs(prevL - left) < 5).length;
                      placed.push(left);
                      const dy = closeCount === 0 ? 0 : closeCount % 2 === 1 ? -11 * Math.ceil(closeCount / 2) : 11 * Math.ceil(closeCount / 2);
                      const k = pinKind(n);
                      const horiz = left > 72 ? "right-0" : left < 28 ? "left-0" : "left-1/2 -translate-x-1/2";
                      const vert = top < 35 ? "top-4" : "bottom-4";
                      return (
                        <a
                          key={`pd-${n.url}`}
                          href={n.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group absolute -translate-x-1/2 -translate-y-1/2 z-10 hover:z-30"
                          style={{ left: `${left}%`, top: `calc(${top}% + ${dy}px)` }}
                          aria-label={`${PIN_LABEL[k] ?? "News"}: ${n.title}`}
                        >
                          <span
                            className="block h-3 w-3 rounded-full border-2 border-[#040814] shadow transition-transform group-hover:scale-125"
                            style={{ backgroundColor: PIN_COLOR[k] ?? "#94a3b8" }}
                          />
                          <span
                            className={`pointer-events-none absolute z-20 hidden w-48 sm:w-56 rounded-lg border border-slate-700 bg-[#050811] p-2 text-[10px] leading-snug text-slate-200 shadow-xl group-hover:block group-focus:block ${horiz} ${vert}`}
                          >
                            <span className="block font-bold text-white">{n.title}</span>
                            <span className="mt-0.5 block text-slate-400">
                              {PIN_LABEL[k] ?? "News"} · {new Date(n.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}
                              {n.changePct !== null ? ` · ${n.changePct >= 0 ? "+" : ""}${n.changePct.toFixed(2)}% since` : ""}
                            </span>
                          </span>
                        </a>
                      );
                    });
                  })()}

                  {/* "NY closed" gap badge floats inside the chart (bottom left, above the time axis): it depends on the
                      cursor, and as a line above the chart it wrapped and pushed the chart (and its news dots) around */}
                  {!peerStock && isMarketClosed && Math.abs(gapAtCursor) >= 0.3 && (
                    <span
                      className={`pointer-events-none absolute bottom-8 left-3 z-10 rounded-lg border px-2 py-0.5 font-mono tabular-nums text-[10px] font-semibold backdrop-blur-sm ${
                        gapAtCursor < 0
                          ? "border-emerald-500/40 bg-emerald-950/80 text-emerald-300"
                          : "border-amber-500/40 bg-amber-950/80 text-amber-200"
                      }`}
                    >
                      NY closed · DEX {Math.abs(gapAtCursor).toFixed(2)}% {gapAtCursor < 0 ? "below" : "above"} last NAV
                    </span>
                  )}

                  {/* Floating crosshair tooltip */}
                  {hoverT !== null && (
                    <div
                      className={`pointer-events-none absolute top-2 z-20 rounded-xl border border-slate-700/90 bg-[#070d1d]/95 px-2.5 py-1.5 font-mono tabular-nums text-[10px] text-slate-200 shadow-xl backdrop-blur-md ${
                        cursorLeftPct > 60 ? "right-16" : "left-3"
                      }`}
                    >
                      <div className="text-slate-400">{fmtTime(hoverT)}</div>
                      {peerStock ? (
                        <div className="flex gap-2.5">
                          <span className="text-white">{activeStock.symbol}: {(navAt?.[1] ?? 0).toFixed(2)}%</span>
                          <span className="text-pink-300">{peerStock.symbol}: {(peerAt?.[1] ?? 0).toFixed(2)}%</span>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-x-2.5">
                          <span>NAV: <strong className="text-white">${displayedNav.toFixed(2)}</strong></span>
                          {dexAt && <span>DEX: <strong className="text-cyan-300">${displayedDex.toFixed(2)}</strong></span>}
                          <span className={gapAtCursor <= 0 ? "text-emerald-300" : "text-amber-300"}>
                            {gapAtCursor >= 0 ? "+" : ""}{gapAtCursor.toFixed(2)}%
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* DEX vs NAV historical spread histogram sub-chart */}
                {spreadBars.length > 0 && (
                  <div className="mt-2 rounded-xl border border-slate-800/80 bg-[#050a18]/80 px-3 py-2">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                      <span className="font-semibold text-slate-300">DEX vs NAV Spread History (%)</span>
                      <span className="font-mono tabular-nums">
                        {hoverSpread ? (
                          <span className={hoverSpread.pct <= 0 ? "text-emerald-300" : "text-amber-300"}>
                            {fmtTime(hoverSpread.t)}: {hoverSpread.pct >= 0 ? "+" : ""}{hoverSpread.pct.toFixed(2)}% vs NAV
                          </span>
                        ) : (
                          <>
                            <span className="text-emerald-300">Below NAV</span> · <span className="text-amber-300">Above NAV</span>
                          </>
                        )}
                      </span>
                    </div>
                    <svg
                      viewBox={`0 0 ${svgWidth} 44`}
                      className="w-full h-11 overflow-visible cursor-crosshair touch-pan-y"
                      onMouseLeave={() => setHoverSpread(null)}
                      onTouchEnd={() => setHoverSpread(null)}
                      onTouchCancel={() => setHoverSpread(null)}
                      onTouchMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const touch = e.touches[0];
                        if (!touch || !rect.width || spreadBars.length === 0) return;
                        const svgX = ((touch.clientX - rect.left) / rect.width) * svgWidth;
                        const nearest = spreadBars.reduce((best, cur) => (Math.abs(x(cur.t) - svgX) < Math.abs(x(best.t) - svgX) ? cur : best));
                        setHoverSpread(nearest);
                      }}
                    >
                      <line x1={padL} x2={svgWidth - padR} y1={22} y2={22} stroke="rgba(148, 163, 184, 0.35)" strokeDasharray="3 3" />
                      <text x={svgWidth - 4} y={25} textAnchor="end" fill="rgba(148, 163, 184, 0.7)" fontSize="9" fontFamily="ui-monospace, monospace">
                        0%
                      </text>
                      {spreadBars.map((b) => {
                        const bx = x(b.t);
                        const h = Math.max(2, (Math.abs(b.pct) / spreadAmp) * 18);
                        const barW = Math.max(4, (plotW / spreadBars.length) * 0.68);
                        const by = b.pct >= 0 ? 22 - h : 22;
                        const active = hoverSpread?.t === b.t;
                        return (
                          <rect
                            key={b.t}
                            x={bx - barW / 2}
                            y={by}
                            width={barW}
                            height={h}
                            rx={1.5}
                            fill={b.pct <= 0 ? "#34d399" : "#fbbf24"}
                            fillOpacity={active ? 1 : 0.78}
                            onMouseEnter={() => setHoverSpread(b)}
                          >
                            <title>{`${fmtTime(b.t)}: ${b.pct >= 0 ? "+" : ""}${b.pct.toFixed(2)}% vs NAV`}</title>
                          </rect>
                        );
                      })}
                    </svg>
                  </div>
                )}
              </>
            ) : (
              <div className="h-56 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-800 text-xs text-slate-400 px-4 text-center">
                <span>{loading ? "Loading real price history…" : "Price history unavailable right now — no synthetic data is shown."}</span>
                {!loading && (
                  <button
                    type="button"
                    onClick={() => {
                      loadHistory(activeStock.symbol, timeframe, true).finally(() => setCacheTick((n) => n + 1));
                    }}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-white hover:border-[#4C6FFF] cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              {peerStock ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-slate-300 font-medium">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeStock.color }} />
                    {activeStock.symbol} NAV %
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-pink-300 font-medium">
                    <span className="h-0.5 w-4 bg-pink-400 inline-block" />
                    {peerStock.symbol} NAV %
                  </span>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowNav((v) => (!v ? true : showDex ? false : true))}
                    aria-pressed={showNav}
                    className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium transition cursor-pointer ${
                      showNav ? "text-slate-200 hover:bg-slate-800/60" : "text-slate-500 opacity-60 hover:opacity-90"
                    }`}
                    title="Toggle Chainlink NAV line"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeStock.color }} />
                    Chainlink NAV ({navRaw.length} rounds, 24/5)
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDex((v) => (!v ? true : showNav ? false : true))}
                    aria-pressed={showDex}
                    className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium transition cursor-pointer ${
                      showDex ? "text-cyan-300 hover:bg-slate-800/60" : "text-slate-500 opacity-60 hover:opacity-90"
                    }`}
                    title="Toggle Base DEX line"
                  >
                    <span className="h-0.5 w-4 bg-cyan-400 inline-block" />
                    DEX price ({dexRaw.length} candles, 24/7)
                  </button>
                </>
              )}
              {!peerStock && navSplit.gaps.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-slate-400 font-medium">
                  <span className="h-2.5 w-3 rounded-sm bg-slate-400/20 border border-slate-400/40 inline-block" />
                  NY closed (NAV paused)
                </span>
              )}
            </div>

            {!peerStock && hasData ? (
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-emerald-300">Below NAV</span>
                <div className="relative h-2 w-24 rounded-full bg-gradient-to-r from-emerald-500/40 via-slate-700 to-amber-500/40">
                  <span className="absolute left-1/2 top-0 h-2 w-px bg-slate-300/60" />
                  <span
                    className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white ${
                      gapAtCursor <= -0.05 ? "bg-emerald-400" : gapAtCursor >= 0.05 ? "bg-amber-400" : "bg-cyan-300"
                    }`}
                    style={{ left: `${gaugePosPct}%` }}
                  />
                </div>
                <span className="text-amber-300">Above NAV</span>
              </div>
            ) : (
              <span className="font-mono text-[11px] text-slate-500">Sources: Chainlink onchain · GeckoTerminal</span>
            )}
          </div>
        </div>

        <div className="lg:col-span-4 min-w-0 rounded-2xl border border-slate-800/90 bg-[#050914] p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Live onchain data</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                <Activity className="h-3 w-3" />
                BASE 8453
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 font-mono text-xs">
              <div className="rounded-xl border border-slate-800/90 bg-[#081022] p-3">
                <div className="text-[10px] text-slate-400 font-sans">B20 uiMultiplier</div>
                <div className="text-sm font-extrabold text-emerald-400 mt-0.5">{uiMultiplier.toFixed(6)}x</div>
                <div className="text-[10px] text-slate-500">dividends & splits</div>
              </div>
              <div className="rounded-xl border border-slate-800/90 bg-[#081022] p-3">
                <div className="text-[10px] text-slate-400 font-sans">DEX liquidity (all pools)</div>
                <div className="text-sm font-extrabold text-cyan-300 mt-0.5">
                  {liquidityUsd !== undefined
                    ? liquidityUsd >= 1_000_000
                      ? `$${(liquidityUsd / 1e6).toFixed(2)}M`
                      : `$${(liquidityUsd / 1e3).toFixed(0)}K`
                    : "—"}
                </div>
                <div className="text-[10px] text-slate-500">
                  24h vol:{" "}
                  {volume24hUsd !== undefined
                    ? volume24hUsd >= 1_000_000
                      ? `$${(volume24hUsd / 1e6).toFixed(2)}M`
                      : `$${(volume24hUsd / 1e3).toFixed(0)}K`
                    : "—"}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800/90 bg-[#081022] p-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">B20 token:</span>
                <a
                  href={activeStock.basescanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-cyan-300 hover:underline inline-flex items-center gap-1"
                >
                  {activeStock.b20Address.slice(0, 10)}...{activeStock.b20Address.slice(-4)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Chainlink feed:</span>
                <a
                  href={`https://basescan.org/address/${activeStock.chainlinkFeed}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-blue-300 hover:underline inline-flex items-center gap-1"
                >
                  {activeStock.chainlinkFeed.slice(0, 8)}...{activeStock.chainlinkFeed.slice(-4)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Prospectus:</span>
                <a
                  href={activeStock.prospectusUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-amber-300 hover:underline inline-flex items-center gap-1"
                >
                  <FileText className="h-3 w-3" />
                  Coinbase PDF
                </a>
              </div>
            </div>
          </div>

          <div className="min-w-0 space-y-2 pt-2 border-t border-slate-800/80">
            <SwapPanel
              stock={activeStock}
              stocks={stockList}
              onSelectSymbol={onSelectSymbol}
              price={liveActive ? liveActive.dexPrice24_7 || liveActive.navPrice : 0}
              dexLiquidityUsd={liquidityUsd}
              tradeUsd={tradeUsd}
              onTradeUsdChange={onTradeUsdChange}
              usdcBalance={usdcBalance}
              ethBalance={ethBalance}
              ethUsd={ethUsd}
              holdingTokens={holdingTokens}
              walletConnected={walletConnected}
              pending={pending}
              pendingLabel={pendingLabel}
              onBuy={onBuy}
              onSell={onSell}
            />
            <button
              onClick={() => onSendToAgent(activeStock.symbol)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 hover:bg-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition cursor-pointer"
            >
              <Bot className="h-3.5 w-3.5 text-cyan-400" />
              Build a basket around {activeStock.symbol}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Same limits as /api/swap, so the panel never offers an amount the server would refuse */
const BUY_MIN_USD = MIN_BUY_USD;
const BUY_MAX_USD = 2500;
const SELL_MIN_USD = 0.25;
// ETH kept back for network fees when paying with ETH (~$0.2): Max never spends the gas money
const ETH_GAS_RESERVE = 0.0001;

/** Buy/Sell one stock for any amount (USDC in, or a share of the current holding out). */
function SwapPanel({
  stock,
  stocks,
  onSelectSymbol,
  price,
  dexLiquidityUsd,
  tradeUsd,
  onTradeUsdChange,
  usdcBalance,
  ethBalance,
  ethUsd,
  holdingTokens,
  walletConnected,
  pending,
  pendingLabel,
  onBuy,
  onSell,
}: {
  stock: TokenizedStockMetadata;
  stocks?: TokenizedStockMetadata[];
  onSelectSymbol?: (sym: string) => void;
  price: number;
  dexLiquidityUsd?: number;
  tradeUsd: number;
  onTradeUsdChange: (usd: number) => void;
  usdcBalance: number | null;
  ethBalance: number | null;
  ethUsd: number | null;
  holdingTokens: number;
  walletConnected: boolean;
  pending: boolean;
  pendingLabel: string;
  onBuy: (stock: TokenizedStockMetadata, usd: number, payWith: "usdc" | "eth") => void;
  onSell: (stock: TokenizedStockMetadata, tokens: number) => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [payWith, setPayWith] = useState<"usdc" | "eth">("usdc");
  const [sellPct, setSellPct] = useState<number>(100);
  const [draft, setDraft] = useState<string>(String(tradeUsd));
  // Follow outside changes (chips, Max) without clobbering what is being typed ("1." → 1)
  useEffect(
    () => setDraft((d) => (d === "." || (Number.isFinite(Number(d)) && Number(d) === tradeUsd) ? d : String(tradeUsd))),
    [tradeUsd]
  );

  const holdingUsd = holdingTokens * price;
  const sellTokens = (holdingTokens * sellPct) / 100;
  const sellUsd = sellTokens * price;
  const estTokens = price > 0 ? tradeUsd / price : 0;

  let problem = "";
  if (side === "buy") {
    if (!(tradeUsd >= BUY_MIN_USD)) problem = `Minimum is $${BUY_MIN_USD.toFixed(2)}`;
    else if (tradeUsd > BUY_MAX_USD) problem = `Maximum is $${BUY_MAX_USD.toLocaleString("en-US")} per order`;
    else if (payWith === "usdc" && walletConnected && usdcBalance !== null && tradeUsd > usdcBalance) problem = "Not enough USDC on Base";
    else if (payWith === "eth" && !ethUsd) problem = "Loading ETH price…";
    else if (!(price > 0)) problem = "Loading price…";
    else if (payWith === "eth" && walletConnected && ethBalance !== null && tradeUsd / ethUsd! > ethBalance - ETH_GAS_RESERVE)
      problem = "Not enough ETH on Base (keep a little for fees)";
  } else if (!walletConnected) problem = "Connect your wallet to sell";
  else if (holdingTokens <= 0) problem = `You don't hold ${stock.symbol}`;
  else if (!(price > 0)) problem = "Loading price…";
  else if (sellUsd < SELL_MIN_USD) problem = `Minimum sell is $${SELL_MIN_USD}`;
  else if (sellUsd > BUY_MAX_USD) problem = `Maximum is $${BUY_MAX_USD.toLocaleString("en-US")} per order`;

  const commit = (v: string) => {
    const n = Math.round((Number(v) || 0) * 100) / 100;
    onTradeUsdChange(Math.max(0, n));
  };
  const maxBuy =
    payWith === "eth"
      ? ethBalance !== null && ethUsd
        ? Math.min(BUY_MAX_USD, Math.floor(Math.max(0, ethBalance - ETH_GAS_RESERVE) * ethUsd * 100) / 100)
        : null
      : usdcBalance !== null
      ? Math.min(BUY_MAX_USD, Math.floor(usdcBalance * 100) / 100)
      : null;
  const ethNeeded = ethUsd ? tradeUsd / ethUsd : null;
  const ethEnough = ethBalance !== null && ethUsd !== null && ethBalance - ETH_GAS_RESERVE >= tradeUsd / ethUsd;
  const chip = "rounded-lg border px-2 py-1 text-[11px] font-bold transition cursor-pointer";

  return (
    <div id="swap-panel" className="min-w-0 rounded-2xl border border-slate-800 bg-[#050a18] p-3 space-y-3 scroll-mt-40">
      {stocks && stocks.length > 1 && onSelectSymbol && (
        <div className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
          <label htmlFor="swap-stock-select" className="shrink-0 text-slate-400 font-semibold">
            Asset
          </label>
          <select
            id="swap-stock-select"
            name="swapStockSymbol"
            value={stock.symbol}
            onChange={(e) => onSelectSymbol(e.target.value)}
            className="min-w-0 w-full flex-1 truncate rounded-lg border border-slate-700 bg-[#040814] px-2.5 py-1 font-mono text-xs font-bold text-white focus:border-[#4C6FFF] focus:outline-none cursor-pointer"
          >
            {stocks.map((st) => (
              <option key={st.symbol} value={st.symbol} className="bg-[#040814]">
                {st.symbol} · {st.companyName}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#040814] p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`rounded-lg py-1.5 text-xs font-bold capitalize transition cursor-pointer ${
              side === s ? (s === "buy" ? "bg-[#4C6FFF] text-white" : "bg-rose-500/80 text-white") : "text-slate-400 hover:text-white"
            }`}
          >
            {s} {stock.symbol}
          </button>
        ))}
      </div>
      <MarketStatus showDetail className="text-[10px] leading-snug" />

      {side === "buy" ? (
        <>
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>Pay with</span>
            <div className="inline-flex rounded-lg border border-slate-800 bg-[#040814] p-0.5">
              {(["usdc", "eth"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPayWith(t)}
                  aria-pressed={payWith === t}
                  className={`rounded-md px-2.5 py-1 font-bold uppercase transition cursor-pointer ${
                    payWith === t ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="swap-amount-usd" className="flex items-center justify-between text-[11px] text-slate-400">
              <span>You pay (USD)</span>
              {walletConnected && payWith === "usdc" && usdcBalance !== null && (
                <span className="font-mono tabular-nums">Balance: {(Math.floor(usdcBalance * 100) / 100).toFixed(2)} USDC</span>
              )}
              {walletConnected && payWith === "eth" && ethBalance !== null && (
                <span className="font-mono tabular-nums">
                  Balance: {ethBalance.toFixed(5)} ETH{ethUsd ? ` ≈ $${(ethBalance * ethUsd).toFixed(2)}` : ""}
                </span>
              )}
            </label>
            <div className="mt-1 flex items-center rounded-xl border border-slate-700 bg-[#040814] px-3 focus-within:border-[#4C6FFF]">
              <span className="text-slate-400 font-mono">$</span>
              <input
                id="swap-amount-usd"
                name="swapAmountUsd"
                type="number"
                inputMode="decimal"
                min={BUY_MIN_USD}
                max={BUY_MAX_USD}
                step="0.01"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  commit(e.target.value);
                }}
                aria-label="Amount in USD"
                className="w-full bg-transparent px-2 py-2 font-mono tabular-nums text-base font-bold text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[1, 2, 5, 10, 25, 50, 100].map((v) => (
              <button
                key={v}
                onClick={() => onTradeUsdChange(v)}
                className={`${chip} ${tradeUsd === v ? "border-[#4C6FFF] bg-[#4C6FFF]/20 text-white" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}
              >
                ${v}
              </button>
            ))}
            <button
              type="button"
              disabled={maxBuy === null || maxBuy < BUY_MIN_USD}
              onClick={() => maxBuy !== null && maxBuy >= BUY_MIN_USD && onTradeUsdChange(maxBuy)}
              className={`${chip} border-slate-700 text-slate-300 hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed`}
              title={maxBuy !== null && maxBuy >= BUY_MIN_USD ? `Use wallet max ($${maxBuy.toFixed(2)})` : "Connect wallet with balance to use Max"}
            >
              Max
            </button>
          </div>
          {walletConnected && maxBuy !== null && maxBuy >= BUY_MIN_USD && (
            <div className="flex items-center justify-between gap-1.5 text-[10px] text-slate-400">
              <span>Wallet %</span>
              <div className="flex gap-1">
                {[0.25, 0.5, 1].map((frac) => {
                  const rawAmt = Math.floor(maxBuy * frac * 100) / 100;
                  const belowMin = rawAmt < BUY_MIN_USD;
                  const amt = frac === 1 ? maxBuy : rawAmt;
                  return (
                    <button
                      key={frac}
                      type="button"
                      disabled={belowMin}
                      onClick={() => !belowMin && onTradeUsdChange(amt)}
                      className="rounded-md border border-slate-700 px-2 py-0.5 font-mono text-slate-300 hover:border-cyan-400 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {frac === 1 ? "100%" : `${Math.round(frac * 100)}%`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {payWith === "eth" && ethNeeded !== null && (
            <div className="text-[11px] text-slate-400">
              You pay ≈ <span className="font-mono text-slate-200">{ethNeeded.toFixed(6)} ETH</span>
              <span className="text-slate-500"> at the Chainlink ETH/USD price</span>
            </div>
          )}
          {payWith === "usdc" && problem === "Not enough USDC on Base" && (
            <div className="rounded-xl border border-slate-700 bg-[#070b14] p-2.5 text-[11px] text-slate-300 space-y-1.5">
              <div className="font-semibold text-white">No USDC on Base?</div>
              {ethEnough ? (
                <button onClick={() => setPayWith("eth")} className="text-cyan-300 underline cursor-pointer">
                  Pay with the ETH in your wallet instead
                </button>
              ) : (
                <div>Pay with ETH, or add USDC on the Base network:</div>
              )}
              <div className="text-slate-400">
                Buy USDC on{" "}
                <a href="https://www.coinbase.com/price/usdc" target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
                  Coinbase
                </a>{" "}
                and withdraw it choosing the <span className="text-slate-200">Base</span> network.
              </div>
            </div>
          )}
          <div className="text-[11px] text-slate-400">
            You receive ≈ <span className="font-mono tabular-nums text-slate-200">{price > 0 ? estTokens.toFixed(6) : "…"} {stock.symbol}</span>
            <span className="text-slate-400"> (exact amount quoted before you sign)</span>
          </div>
          {dexLiquidityUsd && dexLiquidityUsd > 0 && tradeUsd > 0 && (
            (() => {
              const impactPct = (tradeUsd / dexLiquidityUsd) * 100;
              return (
                <div className="space-y-1 rounded-lg border border-slate-800/80 bg-[#040814] px-2.5 py-1.5 text-[10px]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Pool depth impact</span>
                    <span
                      className={`font-mono tabular-nums font-bold ${
                        impactPct > 1.5 ? "text-rose-300" : impactPct > 0.5 ? "text-amber-300" : "text-emerald-300"
                      }`}
                    >
                      {impactPct.toFixed(3)}% of pool
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${
                        impactPct > 1.5 ? "bg-rose-400" : impactPct > 0.5 ? "bg-amber-400" : "bg-emerald-400"
                      }`}
                      style={{ width: `${Math.min(100, Math.max(4, (impactPct / 2) * 100))}%` }}
                    />
                  </div>
                </div>
              );
            })()
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>You hold</span>
            <span className="font-mono text-slate-200">
              {holdingTokens.toFixed(6)} {stock.symbol} ≈ ${holdingUsd.toFixed(2)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                onClick={() => setSellPct(p)}
                className={`${chip} ${sellPct === p ? "border-rose-400 bg-rose-500/20 text-white" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}
              >
                {p === 100 ? "All" : `${p}%`}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-slate-400">
            You sell <span className="font-mono text-slate-200">{sellTokens.toFixed(6)} {stock.symbol}</span> ≈{" "}
            <span className="font-mono text-slate-200">${sellUsd.toFixed(2)} USDC</span>
          </div>
        </>
      )}

      <button
        onClick={() => (side === "buy" ? onBuy(stock, tradeUsd, payWith) : onSell(stock, sellTokens))}
        disabled={pending || Boolean(problem)}
        className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-lg transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          side === "buy"
            ? "bg-gradient-to-r from-[#4C6FFF] to-cyan-600 shadow-[#4C6FFF]/30 hover:brightness-110"
            : "bg-gradient-to-r from-rose-600 to-rose-500 shadow-rose-500/20 hover:brightness-110"
        }`}
      >
        <Zap className="h-3.5 w-3.5" />
        {pending
          ? pendingLabel
          : problem ||
            (side === "buy"
              ? `Buy $${tradeUsd.toFixed(2)} of ${stock.symbol}${payWith === "eth" ? " with ETH" : ""}`
              : `Sell ${sellPct === 100 ? "all" : `${sellPct}%`} ${stock.symbol} for USDC`)}
      </button>
    </div>
  );
}

/**
 * 3. Interactive B20 Dividend & Stock-Split Multiplier Simulator (`ERC-8056 Calculator`)
 */
export function B20DividendSplitSimulator({ stocks }: { stocks: LiveTokenizedStock[] }) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>("NVDAc");
  const [rawTokensInput, setRawTokensInput] = useState<number>(10);
  const [simulatedDividendPct, setSimulatedDividendPct] = useState<number>(2.5);
  const [simulatedSplitRatio, setSimulatedSplitRatio] = useState<number>(1);

  const stockList = stocks.length > 0 ? stocks : BASE_TOKENIZED_STOCKS;
  const activeStock =
    stockList.find((s) => s.symbol === selectedSymbol) || stockList[0];

  const liveActive = "navPrice" in activeStock ? (activeStock as LiveTokenizedStock) : null;
  // 0 until live data has loaded (no made-up price)
  const liveNavPrice: number = liveActive ? liveActive.navPrice : 0;
  const currentMultiplier: number = liveActive
    ? liveActive.uiMultiplier
    : activeStock.defaultMultiplier;

  // Chainlink Total-Return NAV already prices 1 raw B20 token inclusive of uiMultiplier
  const currentSharesUI = rawTokensInput * currentMultiplier;
  const currentUsdValue = rawTokensInput * liveNavPrice;

  // Simulated multiplier after hypothetical dividend adjustment & stock split
  const simulatedNewMultiplier =
    currentMultiplier * (1 + simulatedDividendPct / 100) * simulatedSplitRatio;
  const simulatedSharesUI = rawTokensInput * simulatedNewMultiplier;
  const simulatedUsdValue = rawTokensInput * liveNavPrice * (1 + simulatedDividendPct / 100);
  const dividendGainUsd = simulatedUsdValue - currentUsdValue;

  return (
    <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-400">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-bold text-white">
                Interactive B20 Dividend & Stock-Split Simulator (ERC-8056)
              </h3>
              <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                Hypothetical calculator
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Hypothetical illustration of Coinbase&apos;s <code className="text-emerald-300">uiMultiplier()</code>{" "}
              adjustments. Dividends are not guaranteed and adjustments are subject to withholding taxes, fees &amp;
              expenses. Not financial advice.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
        {/* Controls */}
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              1. Select B20 Tokenized Equity
            </label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-[#040814] px-3 py-2 text-xs text-white font-semibold focus:border-[#4C6FFF] focus:outline-none"
            >
              {stockList.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.symbol} — {s.companyName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              2. Raw B20 Tokens Held in Wallet
            </label>
            <input
              type="number"
              min={0.01}
              step="any"
              value={rawTokensInput}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0) setRawTokensInput(v);
              }}
              className="w-full rounded-xl border border-slate-700 bg-[#040814] px-3 py-2 font-mono text-xs text-white focus:border-[#4C6FFF] focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              <span>3. Reinvested Dividend Yield</span>
              <span className="font-mono text-emerald-400">+{simulatedDividendPct.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={15}
              step={0.5}
              value={simulatedDividendPct}
              onChange={(e) => setSimulatedDividendPct(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0%</span>
              <span>+5%</span>
              <span>+10%</span>
              <span>+15%</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              4. Corporate Stock Split Event
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { label: "1:1 None", ratio: 1 },
                { label: "2:1 Split", ratio: 2 },
                { label: "4:1 Split", ratio: 4 },
                { label: "10:1 Split", ratio: 10 },
              ].map((sp) => (
                <button
                  key={sp.ratio}
                  onClick={() => setSimulatedSplitRatio(sp.ratio)}
                  className={`rounded-lg py-1.5 text-[11px] font-mono font-bold transition cursor-pointer border ${
                    simulatedSplitRatio === sp.ratio
                      ? "bg-[#4C6FFF] text-white border-blue-400"
                      : "bg-[#040814] text-slate-400 border-slate-800 hover:text-white"
                  }`}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live Output Comparison */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#050914] p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
            <div className="flex items-center gap-2">
              <img
                src={activeStock.logoUrl}
                alt={activeStock.companyName}
                className="h-7 w-7 rounded-full border border-slate-700 bg-slate-900 object-cover"
              />
              <div>
                <div className="font-mono text-xs font-bold text-white">{activeStock.symbol}</div>
                <div className="text-[10px] text-slate-400">
                  Live NAV: ${liveNavPrice.toFixed(2)}
                </div>
              </div>
            </div>
            <div className="text-right font-mono">
              <div className="text-[10px] text-slate-400">Live Base Multiplier</div>
              <div className="text-xs font-bold text-emerald-400">
                {currentMultiplier.toFixed(6)}x
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 font-mono text-xs">
            <div className="rounded-xl border border-slate-800/90 bg-[#080f20] p-2.5">
              <div className="text-[10px] text-slate-400 font-sans">Current Balance (UI)</div>
              <div className="text-sm font-bold text-white mt-0.5">
                {currentSharesUI.toFixed(4)} sh
              </div>
              <div className="text-[11px] text-slate-400">${currentUsdValue.toFixed(2)}</div>
            </div>

            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-2.5">
              <div className="text-[10px] text-emerald-300 font-sans">
                After Dividend / Split ({simulatedNewMultiplier.toFixed(4)}x)
              </div>
              <div className="text-sm font-bold text-emerald-300 mt-0.5">
                {simulatedSharesUI.toFixed(4)} sh
              </div>
              <div className="text-[11px] text-white font-bold">
                ${simulatedUsdValue.toFixed(2)}{" "}
                <span className="text-emerald-400">(+${dividendGainUsd.toFixed(2)})</span>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 leading-relaxed">
            Formula:{" "}
            <code className="text-cyan-300 font-mono">
              balanceOfUI = rawBalance ({rawTokensInput}) × uiMultiplier (
              {simulatedNewMultiplier.toFixed(4)})
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 4. Plain-English Glossary Strip (Demystifying Base Tokenized Stock Terms for Everyone)
 */
export function PlainEnglishGlossaryStrip() {
  const items = [
    {
      term: "B20 Precompile (0xb200...)",
      badge: "Asset Standard",
      plainEnglish:
        "Tokenized stocks issued on Base by Coinbase (like NVDAc or AAPLc): a beneficial claim on a real share held in custody. No voting rights.",
    },
    {
      term: "ERC-8056 uiMultiplier()",
      badge: "Dividends & Splits",
      plainEnglish:
        "Dividends and splits are reflected by a multiplier: your token count stays the same while your share-equivalent balance changes.",
    },
    {
      term: "24/7 DEX vs 24/5 NAV Gap",
      badge: "Price Gap",
      plainEnglish:
        "The Chainlink NAV updates 24/5 while DEX pools trade 24/7, so DEX prices can sit above or below NAV, especially on weekends.",
    },
    {
      term: "ERC-8021 Builder Code",
      badge: "Attribution",
      plainEnglish:
        "A small tag appended to this app's transactions so their onchain activity is attributed to MAXXAGENT.",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      {items.map((item) => (
        <div
          key={item.term}
          className="glass-panel glass-panel-hover rounded-2xl p-4 space-y-1.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-white">
              <HelpCircle className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
              {item.term}
            </span>
            <span className="rounded-md bg-[#4C6FFF]/20 border border-[#4C6FFF]/40 px-2 py-0.5 text-[10px] font-semibold text-blue-200 shrink-0">
              {item.badge}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">{item.plainEnglish}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * 5. Basket snapshot from LIVE data only (no backtests, no projected returns).
 */
export function BasketSnapshotCard({
  allocations,
}: {
  allocations: {
    symbol: string;
    targetWeightBps: number;
    weekendGapPct: number;
    dexLiquidityUsd?: number;
    uiMultiplier: number;
    beta: number;
  }[];
}) {
  const w = (a: { targetWeightBps: number }) => a.targetWeightBps / 10000;
  const weightedGap = allocations.reduce((acc, a) => acc + a.weekendGapPct * w(a), 0);
  const weightedBeta = allocations.reduce((acc, a) => acc + a.beta * w(a), 0);
  const thin = allocations.filter((a) => (a.dexLiquidityUsd ?? 0) < 100_000).map((a) => a.symbol);
  const withDividends = allocations.filter((a) => a.uiMultiplier > 1.00001).map((a) => a.symbol);

  return (
    <div className="rounded-2xl border border-slate-700/80 bg-[#050a16] p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300">
          <TrendingUp className="h-3.5 w-3.5" />
          Basket snapshot (live data)
        </div>
        <span className="text-[10px] text-slate-500">No projected returns: past prices only</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
        <div className="rounded-xl border border-slate-800/90 bg-[#040814]/90 p-3">
          <div className="text-[10px] text-slate-400 font-sans">Weighted DEX vs NAV</div>
          <div className={`text-base font-extrabold mt-0.5 ${weightedGap <= 0 ? "text-emerald-400" : "text-amber-300"}`}>
            {weightedGap >= 0 ? "+" : ""}
            {weightedGap.toFixed(2)}%
          </div>
          <div className="text-[10px] text-slate-500">{weightedGap <= 0 ? "below NAV" : "above NAV"}</div>
        </div>
        <div className="rounded-xl border border-slate-800/90 bg-[#040814]/90 p-3">
          <div className="text-[10px] text-slate-400 font-sans">Weighted beta</div>
          <div className="text-base font-extrabold text-cyan-300 mt-0.5">{weightedBeta.toFixed(2)}</div>
          <div className="text-[10px] text-slate-500">static estimate</div>
        </div>
        <div className="rounded-xl border border-slate-800/90 bg-[#040814]/90 p-3">
          <div className="text-[10px] text-slate-400 font-sans">Thin liquidity</div>
          <div className={`text-base font-extrabold mt-0.5 ${thin.length ? "text-amber-300" : "text-emerald-400"}`}>
            {thin.length ? thin.join(", ") : "None"}
          </div>
          <div className="text-[10px] text-slate-500">&lt; $100K in DEX pools</div>
        </div>
        <div className="rounded-xl border border-slate-800/90 bg-[#040814]/90 p-3">
          <div className="text-[10px] text-slate-400 font-sans">Multiplier &gt; 1</div>
          <div className="text-base font-extrabold text-blue-300 mt-0.5">{withDividends.length}</div>
          <div className="text-[10px] text-slate-500 truncate">{withDividends.join(", ") || "—"}</div>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Prices can move against you and DEX prices can differ from NAV. Execution cost is shown per stock before you sign.
        Not financial advice.
      </p>
    </div>
  );
}

export interface OnchainActivityEntry {
  id: string;
  action: string;
  network: string;
  builderCode: string;
  txHash: string;
  timestamp: string;
}

/**
 * 6. Persistent Onchain Execution & Attribution Activity Log (For 50% Traction Proof)
 */
export function OnchainActivityLogPanel({
  entries,
  onClear,
}: {
  entries: OnchainActivityEntry[];
  onClear: () => void;
}) {
  return (
    <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4C6FFF]/20 border border-[#4C6FFF]/40 text-blue-300">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-bold text-white">
                Your onchain activity (this browser)
              </h3>
              <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                {entries.length} transactions
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Transactions you sent from MAXXAGENT, stored only in this browser. Verify each on BaseScan.
            </p>
          </div>
        </div>
        {entries.length > 0 && (
          <button
            onClick={onClear}
            className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-[11px] text-slate-300 hover:text-white transition cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
        {entries.map((entry) => {
          const isMainnet = entry.network.includes("Mainnet");
          const explorerUrl = `https://basescan.org/tx/${entry.txHash}`;

          return (
            <div
              key={entry.id}
              className="rounded-xl border border-slate-800/90 bg-[#050914] p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    ERC-8021 [{entry.builderCode}]
                  </span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
                    {entry.network}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">{entry.timestamp}</span>
                </div>
                <div className="text-xs font-bold text-white font-mono">{entry.action}</div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isMainnet ? (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-[#4C6FFF]/40 bg-[#4C6FFF]/15 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-blue-200 hover:bg-[#4C6FFF]/30 transition"
                  >
                    {entry.txHash.slice(0, 10)}...{entry.txHash.slice(-6)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="rounded-lg border border-slate-800 bg-[#081022] px-2.5 py-1.5 font-mono text-[11px] text-slate-400">
                    Sim Hash: {entry.txHash.slice(0, 10)}...{entry.txHash.slice(-6)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

