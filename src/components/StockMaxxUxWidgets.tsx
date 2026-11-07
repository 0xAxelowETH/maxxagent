"use client";

import { MarketStatus } from "./MarketStatus";
import React, { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  Calculator,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileText,
  HelpCircle,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { BASE_TOKENIZED_STOCKS, LiveTokenizedStock, TokenizedStockMetadata } from "@/lib/tokenizedStocks";

interface GuidedQuickStartBarProps {
  activeTab: string;
  setActiveTab: (tab: "terminal" | "agent" | "indexes" | "traction" | "public") => void;
  proMode: boolean;
  onToggleProMode: () => void;
  onQuickRunAgent: () => void;
  onQuickBuy: () => void;
}

/**
 * 1. Interactive 3-Step Guided Onboarding Wizard + Demo Portfolio & Simple/Pro Mode Toggles
 */
export function GuidedQuickStartBar({
  activeTab,
  setActiveTab,
  proMode,
  onToggleProMode,
  onQuickRunAgent,
  onQuickBuy,
}: GuidedQuickStartBarProps) {
  return (
    <div className="hero-mesh-card rounded-3xl p-5 sm:p-6 relative overflow-hidden animate-fade-up">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/15 border border-cyan-500/35 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-cyan-300">
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            Quick start
          </div>
          <h3 className="text-base sm:text-lg font-extrabold text-white tracking-tight pt-0.5">
            Pick a basket of tokenized stocks and buy it in one click
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Simple View vs Pro / Developer View Toggle */}
          <button
            onClick={onToggleProMode}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-all cursor-pointer border ${
              proMode
                ? "bg-[#4C6FFF]/25 text-blue-200 border-[#4C6FFF]/60 shadow-md shadow-[#4C6FFF]/20"
                : "bg-[#060c1c] text-slate-300 border-slate-700/90 hover:border-slate-500 hover:text-white"
            }`}
            title="Toggle raw hex calldata & developer telemetry"
          >
            <Eye className="h-3.5 w-3.5 text-cyan-400" />
            {proMode ? "View: Pro Developer Hex" : "View: Simple Guided"}
          </button>
        </div>
      </div>

      {/* 3-Step Visual Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
        {/* Step 1 */}
        <div
          className={`rounded-2xl border p-4 transition-all flex flex-col justify-between gap-3 ${
            activeTab === "terminal"
              ? "border-[#4C6FFF]/70 bg-gradient-to-b from-[#0b1736]/95 to-[#060c1d]/95 shadow-lg shadow-[#4C6FFF]/15"
              : "border-slate-800/90 bg-[#050a16]/85 hover:border-slate-700"
          }`}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-blue-500/20 border border-blue-400/40 px-2.5 py-0.5 font-mono text-[10px] font-extrabold text-blue-300">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                STEP 01 • EXPLORE
              </span>
              <TrendingUp className="h-4 w-4 text-blue-400" />
            </div>
            <div className="text-sm font-bold text-white">
              See 10 live tokenized stocks
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Compare the 24/5 Chainlink NAV with 24/7 DEX prices, liquidity and dividend multipliers.
            </p>
          </div>
          <button
            onClick={() => setActiveTab("terminal")}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700 px-3.5 py-2 text-xs font-bold text-cyan-300 transition cursor-pointer"
          >
            Open live market
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Step 2 */}
        <div
          className={`rounded-2xl border p-4 transition-all flex flex-col justify-between gap-3 ${
            activeTab === "agent"
              ? "border-[#4C6FFF]/70 bg-gradient-to-b from-[#0b1736]/95 to-[#060c1d]/95 shadow-lg shadow-[#4C6FFF]/15"
              : "border-slate-800/90 bg-[#050a16]/85 hover:border-slate-700"
          }`}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-cyan-500/20 border border-cyan-400/40 px-2.5 py-0.5 font-mono text-[10px] font-extrabold text-cyan-300">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                STEP 02 • AGENT
              </span>
              <Bot className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="text-sm font-bold text-white">
              Get a basket proposal
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Transparent rules score all 10 stocks on DEX vs NAV gap, liquidity, multiplier and your
              risk profile.
            </p>
          </div>
          <button
            onClick={() => {
              setActiveTab("agent");
              onQuickRunAgent();
            }}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#4C6FFF] to-blue-600 hover:brightness-110 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-[#4C6FFF]/25 transition cursor-pointer"
          >
            Run the agent
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Step 3 */}
        <div
          className={`rounded-2xl border p-4 transition-all flex flex-col justify-between gap-3 ${
            activeTab === "indexes" || activeTab === "traction"
              ? "border-[#4C6FFF]/70 bg-gradient-to-b from-[#0b1736]/95 to-[#060c1d]/95 shadow-lg shadow-[#4C6FFF]/15"
              : "border-slate-800/90 bg-[#050a16]/85 hover:border-slate-700"
          }`}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2.5 py-0.5 font-mono text-[10px] font-extrabold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                STEP 03 • BUY
              </span>
              <Zap className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-sm font-bold text-white">
              Buy the basket with USDC or ETH
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              One wallet confirmation swaps your USDC or ETH into each stock on Base. Stocks go straight to your
              wallet — MAXXAGENT never holds funds.
            </p>
          </div>
          <button
            onClick={onQuickBuy}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:brightness-110 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-emerald-600/25 transition cursor-pointer"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Go to basket
          </button>
        </div>
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

// Client-side history cache shared by every chart instance: switching back to a stock is instant
const HISTORY_TTL_MS = 5 * 60 * 1000;
const historyCache = new Map<string, { at: number; data: HistoryResponse | null }>();
const inflight = new Map<string, Promise<void>>();

function loadHistory(symbol: string, tf: HistoryTf): Promise<void> {
  const key = `${symbol}:${tf}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return Promise.resolve();
  const running = inflight.get(key);
  if (running) return running;
  const p = fetch(`/api/history?symbol=${symbol}&tf=${tf}`)
    .then((r) => r.json())
    .then((d: HistoryResponse) => {
      // keep a previous good series if a refresh fails
      if (d?.ok || !hit) historyCache.set(key, { at: Date.now(), data: d?.ok ? d : null });
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
  walletConnected: boolean;
  pending: boolean;
  pendingLabel: string;
}) {
  const [timeframe, setTimeframe] = useState<HistoryTf>("7D");
  const [hoverT, setHoverT] = useState<number | null>(null);
  // Bumped when a history response lands, so the chart re-reads the cache
  const [, setCacheTick] = useState(0);

  const stockList: TokenizedStockMetadata[] = stocks.length > 0 ? stocks : BASE_TOKENIZED_STOCKS;
  const activeStock = stockList.find((s) => s.symbol === selectedSymbol) || stockList[0];
  const liveActive = "navPrice" in activeStock ? (activeStock as LiveTokenizedStock) : null;

  const key = `${activeStock.symbol}:${timeframe}`;
  // Only the history of the stock on screen is ever used: never the previous stock's series
  const cachedEntry = historyCache.get(key);
  const history = cachedEntry?.data ?? null;
  const loading = !cachedEntry || Date.now() - cachedEntry.at > HISTORY_TTL_MS;

  useEffect(() => {
    let cancelled = false;
    loadHistory(activeStock.symbol, timeframe).finally(() => {
      if (!cancelled) setCacheTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [activeStock.symbol, timeframe]);

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

  const nav = history?.nav ?? [];
  const dex = history?.dex ?? [];
  const all = [...nav, ...dex];
  const hasData = all.length >= 2;

  const svgWidth = 760;
  const svgHeight = 230;
  const padX = 16;
  const padY = 20;
  const plotW = svgWidth - padX * 2;
  const plotH = svgHeight - padY * 2;

  const tMin = hasData ? Math.min(...all.map((p) => p[0])) : 0;
  const tMax = hasData ? Math.max(...all.map((p) => p[0])) : 1;
  const vMin = hasData ? Math.min(...all.map((p) => p[1])) * 0.998 : 0;
  const vMax = hasData ? Math.max(...all.map((p) => p[1])) * 1.002 : 1;
  const x = (t: number) => padX + ((t - tMin) / Math.max(1, tMax - tMin)) * plotW;
  const y = (v: number) => padY + plotH - ((v - vMin) / Math.max(1e-9, vMax - vMin)) * plotH;
  const toPoints = (s: [number, number][]) => s.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const navPointsStr = toPoints(nav);
  const dexPointsStr = toPoints(dex);
  const areaPointsStr =
    nav.length >= 2
      ? `${x(nav[0][0])},${svgHeight - padY} ${navPointsStr} ${x(nav[nav.length - 1][0])},${svgHeight - padY}`
      : "";

  const cursorT = hoverT ?? tMax;
  const navAt = nearest(nav, cursorT);
  const dexAt = nearest(dex, cursorT);
  const displayedNav = navAt ? navAt[1] : liveActive?.navPrice ?? 0;
  const displayedDex = dexAt ? dexAt[1] : liveActive?.dexPrice24_7 ?? 0;
  const gapAtCursor =
    displayedNav > 0 && displayedDex > 0 ? ((displayedDex - displayedNav) / displayedNav) * 100 : 0;
  const change24h = liveActive?.change24hPct ?? 0;
  const uiMultiplier = liveActive ? liveActive.uiMultiplier : activeStock.defaultMultiplier;
  const liquidityUsd = liveActive?.dexLiquidityUsd;
  const volume24hUsd = liveActive?.dexVolume24hUsd;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!hasData) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * svgWidth;
    const ratio = Math.min(1, Math.max(0, (px - padX) / plotW));
    setHoverT(tMin + ratio * (tMax - tMin));
  };

  const fmtTime = (t: number) =>
    new Date(t * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: timeframe === "30D" ? undefined : "2-digit",
      minute: timeframe === "24H" ? "2-digit" : undefined,
    });

  return (
    <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-5 animate-fade-up">
      {/* Stock selector */}
      <div className="flex items-center justify-between gap-3 overflow-x-auto pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-1.5 shrink-0">
          {stockList.map((st) => {
            const isSel = st.symbol === activeStock.symbol;
            return (
              <button
                key={st.symbol}
                onClick={() => onSelectSymbol(st.symbol)}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-mono font-bold transition-all cursor-pointer border ${
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

        <div className="inline-flex rounded-xl border border-slate-800 bg-[#040814] p-1 shrink-0">
          {(["24H", "7D", "30D"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => {
                setTimeframe(tf);
                setHoverT(null);
              }}
              className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold transition cursor-pointer ${
                timeframe === tf ? "bg-[#4C6FFF] text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-8 flex flex-col justify-between rounded-2xl border border-slate-800/90 bg-[#040814]/90 p-4 sm:p-5 relative overflow-hidden">
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
                    style={{ backgroundColor: activeStock.color }}
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

            <div className="text-right font-mono">
              <div className="flex items-center justify-end gap-2">
                <span className="text-2xl font-extrabold text-white">${displayedNav.toFixed(2)}</span>
                {hoverT === null && (
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
                DEX: <strong>${displayedDex.toFixed(2)}</strong> ({gapAtCursor >= 0 ? "+" : ""}
                {gapAtCursor.toFixed(2)}% vs NAV)
              </div>
              {hoverT !== null && <div className="text-[10px] text-slate-500">{fmtTime(hoverT)}</div>}
            </div>
          </div>

          <div className="my-4 relative select-none">
            {hasData ? (
              <svg
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className="w-full h-52 overflow-visible cursor-crosshair"
                onMouseMove={onMove}
                onMouseLeave={() => setHoverT(null)}
              >
                <defs>
                  <linearGradient id="chart-nav-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={activeStock.color} stopOpacity="0.32" />
                    <stop offset="100%" stopColor={activeStock.color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0.2, 0.5, 0.8].map((ratio) => (
                  <line
                    key={ratio}
                    x1={padX}
                    x2={svgWidth - padX}
                    y1={padY + plotH * ratio}
                    y2={padY + plotH * ratio}
                    stroke="rgba(51, 65, 85, 0.35)"
                    strokeDasharray="4 4"
                  />
                ))}
                {areaPointsStr && <polygon points={areaPointsStr} fill="url(#chart-nav-fill)" />}
                {dex.length >= 2 && (
                  <polyline
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth="2"
                    strokeDasharray="5 4"
                    points={dexPointsStr}
                    opacity="0.9"
                  />
                )}
                {nav.length >= 2 && (
                  <polyline
                    fill="none"
                    stroke={activeStock.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={navPointsStr}
                  />
                )}
                {hoverT !== null && (
                  <line
                    x1={x(hoverT)}
                    x2={x(hoverT)}
                    y1={padY}
                    y2={svgHeight - padY}
                    stroke="rgba(148, 163, 184, 0.45)"
                    strokeDasharray="3 3"
                  />
                )}
                {navAt && (
                  <circle cx={x(navAt[0])} cy={y(navAt[1])} r="5" fill={activeStock.color} stroke="#fff" strokeWidth="2" />
                )}
                {dexAt && <circle cx={x(dexAt[0])} cy={y(dexAt[1])} r="4" fill="#22d3ee" stroke="#fff" strokeWidth="1.5" />}
              </svg>
            ) : (
              <div className="h-52 flex items-center justify-center rounded-xl border border-dashed border-slate-800 text-xs text-slate-400 px-4 text-center">
                {loading ? "Loading real price history…" : "Price history unavailable right now — no synthetic data is shown."}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5 text-slate-300 font-medium">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeStock.color }} />
                Chainlink NAV ({nav.length} rounds, 24/5)
              </span>
              <span className="inline-flex items-center gap-1.5 text-cyan-300 font-medium">
                <span className="h-0.5 w-4 bg-cyan-400 inline-block" />
                DEX price ({dex.length} candles, 24/7)
              </span>
            </div>
            <span className="font-mono text-[11px] text-slate-500">Sources: Chainlink onchain · GeckoTerminal</span>
          </div>
        </div>

        <div className="lg:col-span-4 rounded-2xl border border-slate-800/90 bg-[#050914] p-5 flex flex-col justify-between space-y-4">
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
                  {liquidityUsd !== undefined ? `$${(liquidityUsd / 1e3).toFixed(0)}K` : "—"}
                </div>
                <div className="text-[10px] text-slate-500">
                  24h vol: {volume24hUsd !== undefined ? `$${(volume24hUsd / 1e3).toFixed(0)}K` : "—"}
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

          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <SwapPanel
              stock={activeStock}
              price={liveActive ? liveActive.dexPrice24_7 || liveActive.navPrice : 0}
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
const BUY_MIN_USD = 1;
const BUY_MAX_USD = 2500;
const SELL_MIN_USD = 0.25;
// ETH kept back for network fees when paying with ETH (~$0.2): Max never spends the gas money
const ETH_GAS_RESERVE = 0.0001;

/** Buy/Sell one stock for any amount (USDC in, or a share of the current holding out). */
function SwapPanel({
  stock,
  price,
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
  price: number;
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
  useEffect(() => setDraft((d) => (Number(d) === tradeUsd ? d : String(tradeUsd))), [tradeUsd]);

  const holdingUsd = holdingTokens * price;
  const sellTokens = (holdingTokens * sellPct) / 100;
  const sellUsd = sellTokens * price;
  const estTokens = price > 0 ? tradeUsd / price : 0;

  let problem = "";
  if (side === "buy") {
    if (!(tradeUsd >= BUY_MIN_USD)) problem = `Minimum is $${BUY_MIN_USD}`;
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
    <div id="swap-panel" className="rounded-2xl border border-slate-800 bg-[#050a18] p-3 space-y-3 scroll-mt-24">
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
          <label className="block">
            <span className="flex items-center justify-between text-[11px] text-slate-400">
              <span>You pay (USD)</span>
              {walletConnected && payWith === "usdc" && usdcBalance !== null && <span>Balance: {usdcBalance.toFixed(2)} USDC</span>}
              {walletConnected && payWith === "eth" && ethBalance !== null && (
                <span>
                  Balance: {ethBalance.toFixed(5)} ETH{ethUsd ? ` ≈ $${(ethBalance * ethUsd).toFixed(2)}` : ""}
                </span>
              )}
            </span>
            <div className="mt-1 flex items-center rounded-xl border border-slate-700 bg-[#040814] px-3 focus-within:border-[#4C6FFF]">
              <span className="text-slate-400 font-mono">$</span>
              <input
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
                className="w-full bg-transparent px-2 py-2 font-mono text-base font-bold text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[5, 10, 25, 50, 100].map((v) => (
              <button
                key={v}
                onClick={() => onTradeUsdChange(v)}
                className={`${chip} ${tradeUsd === v ? "border-[#4C6FFF] bg-[#4C6FFF]/20 text-white" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}
              >
                ${v}
              </button>
            ))}
            {maxBuy !== null && maxBuy >= BUY_MIN_USD && (
              <button
                onClick={() => onTradeUsdChange(maxBuy)}
                className={`${chip} border-slate-700 text-slate-300 hover:border-slate-500`}
              >
                Max
              </button>
            )}
          </div>
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
            You receive ≈ <span className="font-mono text-slate-200">{price > 0 ? estTokens.toFixed(6) : "…"} {stock.symbol}</span>
            <span className="text-slate-500"> (exact amount quoted before you sign)</span>
          </div>
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

  const currentSharesUI = rawTokensInput * currentMultiplier;
  const currentUsdValue = currentSharesUI * liveNavPrice;

  // Simulated multiplier after dividend reinvestment & stock split
  const simulatedNewMultiplier =
    currentMultiplier * (1 + simulatedDividendPct / 100) * simulatedSplitRatio;
  const simulatedSharesUI = rawTokensInput * simulatedNewMultiplier;
  const postSplitSharePrice = liveNavPrice / simulatedSplitRatio;
  const simulatedUsdValue = simulatedSharesUI * postSplitSharePrice;
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
              See how Coinbase&apos;s <code className="text-emerald-300">uiMultiplier()</code>{" "}
              automatically increases your share balance during dividends & stock splits without
              manual claiming.
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
              min={0.1}
              step={1}
              value={rawTokensInput}
              onChange={(e) => setRawTokensInput(Math.max(0.01, Number(e.target.value) || 1))}
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
        <span className="text-[10px] text-slate-500">No backtest or projected returns are shown</span>
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
          const isSepolia = entry.network.includes("Sepolia");
          const isMainnet = entry.network.includes("Mainnet");
          const explorerUrl = isSepolia
            ? `https://sepolia.basescan.org/tx/${entry.txHash}`
            : `https://basescan.org/tx/${entry.txHash}`;

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
                  <span className="font-mono text-[11px] text-slate-500">{entry.timestamp}</span>
                </div>
                <div className="text-xs font-bold text-white font-mono">{entry.action}</div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isSepolia || isMainnet ? (
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

