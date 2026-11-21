"use client";

import React from "react";
import { Check, ChevronDown, Copy, ExternalLink, Layers, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { MaxxAgentMark } from "@/components/BrandLogo";
import { PortfolioDonutChart, STOCK_COLOR_MAP, STOCK_LOGO_MAP } from "@/components/PortfolioDonutChart";
import { UsdAmountInput } from "@/components/UsdAmountInput";
import { type BasketLeg } from "@/lib/basketExecutor";
import { basketToQuery } from "@/lib/shareBasket";
import {
  BASE_TOKENIZED_STOCKS,
  LiveTokenizedStock,
  MIN_BUY_USD,
  PROGRAMMABLE_INDEX_PRESETS,
  ProgrammableIndexPreset,
} from "@/lib/tokenizedStocks";

export interface PublishedIndexItem {
  id: number;
  name: string;
  ticker: string;
  creator: string;
  version: number;
  constituents: { symbol: string; b20Address: string; weightBps: number }[];
}

export interface IndexesTabProps {
  publicSiteUrl: string;
  stocks: LiveTokenizedStock[];
  selectedPreset: ProgrammableIndexPreset;
  setSelectedPreset: (p: ProgrammableIndexPreset) => void;
  customIndexName: string;
  setCustomIndexName: (s: string) => void;
  customIndexTicker: string;
  setCustomIndexTicker: (s: string) => void;
  customWeights: Record<string, number>;
  setCustomWeights: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  applyCustomWeights: (next: Record<string, number>) => void;
  builderView: "selected-first" | "selected-only" | "all";
  setBuilderView: (v: "selected-first" | "selected-only" | "all") => void;
  builderPinned: string[];
  setBuilderPinned: (syms: string[]) => void;
  normalizeCustomWeights: () => void;
  equalizeCustomWeights: () => void;
  clearCustomWeights: () => void;
  totalCustomWeightBps: number;
  sharedBasketLoaded: boolean;
  setSharedBasketLoaded: (v: boolean) => void;
  basketUsd: number;
  setBasketUsd: (usd: number) => void;
  basketPayWith: "usdc" | "eth";
  payLabel: string;
  payToggle: React.ReactNode;
  amountControl: React.ReactNode;
  basketPending: boolean;
  basketStatus: string;
  buyStocks: (legs: BasketLeg[], label: string) => void;
  hasRegistry: boolean;
  registryAddress: string;
  txPending: boolean;
  publishStatus: string;
  publishIndexOnchain: (
    name: string,
    ticker: string,
    legs: { b20Address: string; weightBps: number }[]
  ) => void;
  publishedIndexes: PublishedIndexItem[];
  indexesStatus: string;
  loadPublishedIndexes: () => void;
  indexBuys: Record<number, { buys: number; volumeUsd: number; wallets: number }> | null;
  indexSort: "volume" | "buys" | "newest";
  setIndexSort: (s: "volume" | "buys" | "newest") => void;
  copiedKey: string;
  copyToClipboard: (text: string, key: string) => void;
  shareLinkFor: (weightsBps: Record<string, number>, amountUsd?: number) => string;
}

export default function IndexesTab({
  publicSiteUrl,
  stocks,
  selectedPreset,
  setSelectedPreset,
  customIndexName,
  setCustomIndexName,
  customIndexTicker,
  setCustomIndexTicker,
  customWeights,
  setCustomWeights,
  applyCustomWeights,
  builderView,
  setBuilderView,
  builderPinned,
  setBuilderPinned,
  normalizeCustomWeights,
  equalizeCustomWeights,
  clearCustomWeights,
  totalCustomWeightBps,
  sharedBasketLoaded,
  setSharedBasketLoaded,
  basketUsd,
  setBasketUsd,
  basketPayWith,
  payLabel,
  payToggle,
  amountControl,
  basketPending,
  basketStatus,
  buyStocks,
  hasRegistry,
  registryAddress,
  txPending,
  publishStatus,
  publishIndexOnchain,
  publishedIndexes,
  indexesStatus,
  loadPublishedIndexes,
  indexBuys,
  indexSort,
  setIndexSort,
  copiedKey,
  copyToClipboard,
  shareLinkFor,
}: IndexesTabProps) {
  const rankedIndexes = [...publishedIndexes].sort((a, b) => {
    const aStats = indexBuys?.[a.id];
    const bStats = indexBuys?.[b.id];
    if (indexSort === "newest") return b.id - a.id;
    if (indexSort === "buys") {
      return (bStats?.buys ?? 0) - (aStats?.buys ?? 0) || (bStats?.volumeUsd ?? 0) - (aStats?.volumeUsd ?? 0) || b.id - a.id;
    }
    return (bStats?.volumeUsd ?? 0) - (aStats?.volumeUsd ?? 0) || (bStats?.buys ?? 0) - (aStats?.buys ?? 0) || b.id - a.id;
  });

  return (
    <div className="space-y-6">
      {/* Preset Index Cards with Official Stock & Partner Logos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PROGRAMMABLE_INDEX_PRESETS.map((preset) => {
          const isSelected = selectedPreset.id === preset.id;
          const presetKey = preset.allocations.map((a) => `${a.symbol}:${a.weightBps}`).join(",");
          const onchain = publishedIndexes.find(
            (ix) => ix.ticker === preset.ticker && ix.constituents.map((c) => `${c.symbol}:${c.weightBps}`).join(",") === presetKey
          );
          const selectPreset = () => {
            setSelectedPreset(preset);
            setCustomIndexName(preset.name);
            setCustomIndexTicker(preset.ticker);
            const map: Record<string, number> = {};
            preset.allocations.forEach((a) => {
              map[a.symbol] = a.weightBps;
            });
            applyCustomWeights(map);
          };
          return (
            <div
              key={preset.id}
              className={`rounded-2xl border p-5 transition ${
                isSelected
                  ? "border-[#4C6FFF] bg-[#0b152e] shadow-lg shadow-[#4C6FFF]/20"
                  : "border-slate-800 bg-[#0b1120] hover:border-slate-700"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <button
                  type="button"
                  onClick={selectPreset}
                  className="rounded-md bg-[#4C6FFF]/20 border border-[#4C6FFF]/40 px-2.5 py-0.5 font-mono text-xs font-bold text-blue-300 hover:bg-[#4C6FFF]/30 cursor-pointer"
                >
                  {preset.ticker}
                </button>
                <span className="flex flex-wrap items-center gap-2">
                  {onchain && (
                    <a
                      href={`/index/${onchain.id}`}
                      className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-200 hover:border-emerald-400"
                      title="This index is published onchain: open its public page"
                    >
                      Onchain #{onchain.id}
                    </a>
                  )}
                  <span className="text-[11px] font-mono text-slate-400">{preset.riskLevel}</span>
                </span>
              </div>

              <button
                type="button"
                onClick={selectPreset}
                aria-pressed={isSelected}
                className="block w-full text-left cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4C6FFF]"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-base font-bold text-white">{preset.name}</span>
                  <span className="flex flex-wrap -space-x-2 py-0.5 pl-0.5 shrink-0">
                    {preset.allocations.map((a) => (
                      <img
                        key={a.symbol}
                        src={STOCK_LOGO_MAP[a.symbol]}
                        alt={a.symbol}
                        className="h-6 w-6 rounded-full maxx-avatar-ring bg-slate-900 object-cover"
                      />
                    ))}
                  </span>
                </span>

                <span className="block text-xs text-slate-400 mt-1.5 line-clamp-2">{preset.tagline}</span>

                <span className="mt-4 flex flex-wrap gap-1.5">
                  {preset.allocations.map((a) => (
                    <span
                      key={a.symbol}
                      className="inline-flex items-center gap-1 rounded bg-slate-800/90 px-2 py-0.5 font-mono text-[11px] text-slate-200"
                    >
                      <img src={STOCK_LOGO_MAP[a.symbol]} alt={a.symbol} className="h-3.5 w-3.5 rounded-full" />
                      {a.symbol} {(a.weightBps / 100).toFixed(0)}%
                    </span>
                  ))}
                </span>
              </button>

              <div className="mt-3.5 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  1-Click Pack ({basketPayWith.toUpperCase()})
                </span>
                <div className="flex items-center gap-1.5">
                  {[5, 20].map((packUsd) => (
                    <button
                      key={packUsd}
                      type="button"
                      disabled={basketPending}
                      onClick={() => {
                        selectPreset();
                        const legs: BasketLeg[] = preset.allocations.flatMap((a) => {
                          const st = (stocks.length ? stocks : BASE_TOKENIZED_STOCKS).find((x) => x.symbol === a.symbol);
                          const usd = Number(((packUsd * a.weightBps) / 10000).toFixed(2));
                          return st && usd >= MIN_BUY_USD
                            ? [{ symbol: st.symbol, b20Address: st.b20Address, usd, payWith: basketPayWith }]
                            : [];
                        });
                        if (legs.length > 0) buyStocks(legs, preset.ticker);
                      }}
                      className="inline-flex min-h-[28px] items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 cursor-pointer"
                    >
                      <Zap className="h-3 w-3" />
                      Buy ${packUsd}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Programmable Index Constructor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div id="index-builder" className={`${hasRegistry ? "lg:col-span-7" : "lg:col-span-12"} rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-5 scroll-mt-40`}>
          {sharedBasketLoaded && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-3 text-xs text-cyan-100">
              <span>
                <strong>Shared basket loaded.</strong> Check the weights and the amount below, then buy from your own wallet.
                Nothing happens until you confirm.
              </span>
              <button onClick={() => setSharedBasketLoaded(false)} aria-label="Dismiss" className="text-cyan-200 hover:text-white cursor-pointer">
                ✕
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <MaxxAgentMark size={28} />
              <div>
                <h3 className="text-base font-bold text-white">Build your own index</h3>
                <p className="text-xs text-slate-400">
                  Pick up to 10 stocks, set the weights, then buy the basket or share it as a link
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={equalizeCustomWeights}
                className="rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-[#4C6FFF] hover:text-white transition cursor-pointer"
                title="Split weights equally across selected stocks (or all 10)"
              >
                Equal
              </button>
              <button
                type="button"
                onClick={clearCustomWeights}
                className="rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-rose-400/60 hover:text-rose-200 transition cursor-pointer"
                title="Reset all weights to 0%"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={normalizeCustomWeights}
                className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25 transition cursor-pointer"
              >
                Normalize to 100%
              </button>
            </div>
          </div>

          <div className={`grid grid-cols-1 gap-3 ${hasRegistry ? "sm:grid-cols-2" : ""}`}>
            <div>
              <label htmlFor="custom-index-name" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Index Name
              </label>
              <input
                id="custom-index-name"
                name="customIndexName"
                type="text"
                value={customIndexName}
                onChange={(e) => setCustomIndexName(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 text-xs text-white"
              />
            </div>
            {hasRegistry && (
              <div>
                <label htmlFor="custom-index-ticker" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Index Ticker Symbol
                </label>
                <input
                  id="custom-index-ticker"
                  name="customIndexTicker"
                  type="text"
                  value={customIndexTicker}
                  onChange={(e) => setCustomIndexTicker(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 font-mono text-xs text-white"
                />
              </div>
            )}
          </div>

          {/* Interactive SVG Donut Chart for Custom Index Basket */}
          <div className="rounded-2xl border border-slate-800/90 bg-[#050914]/90 p-4">
            <PortfolioDonutChart
              items={Object.entries(customWeights)
                .filter(([, w]) => w > 0)
                .map(([sym, w]) => ({
                  symbol: sym,
                  weightBps: w,
                  color: STOCK_COLOR_MAP[sym] || "#4C6FFF",
                  logoUrl: STOCK_LOGO_MAP[sym],
                }))}
              centerLabel={customIndexTicker}
              centerValue={`${(totalCustomWeightBps / 100).toFixed(0)}%`}
            />
            <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-400">
                {Object.values(customWeights).filter((w) => w > 0).length} selected ·{" "}
                <strong className={`font-mono ${totalCustomWeightBps === 10000 ? "text-emerald-400" : "text-amber-400"}`}>
                  {(totalCustomWeightBps / 100).toFixed(0)}% allocated
                </strong>
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  data-testid="builder-view-filter"
                  className="inline-flex rounded-lg border border-slate-800 bg-[#040814] p-0.5 text-[11px]"
                  role="group"
                  aria-label="Filter stock sliders"
                >
                  {(
                    [
                      { id: "selected-first", label: "Selected first" },
                      {
                        id: "selected-only",
                        label: `Selected (${Object.values(customWeights).filter((w) => w > 0).length})`,
                      },
                      { id: "all", label: "All (10)" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={builderView === opt.id}
                      onClick={() => {
                        if (opt.id === "selected-first") {
                          setBuilderPinned(
                            Object.entries(customWeights)
                              .filter(([, w]) => w > 0)
                              .map(([s]) => s)
                          );
                        }
                        setBuilderView(opt.id);
                      }}
                      className={`rounded-md px-2 py-1 font-medium transition cursor-pointer ${
                        builderView === opt.id
                          ? "bg-[#4C6FFF] text-white"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => document.getElementById("builder-actions")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/20 transition cursor-pointer"
                >
                  Amount &amp; Buy / Publish
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Sliders for the 10 supported Coinbase B20 tokenized stocks */}
          {(() => {
            const baseList = stocks.length > 0 ? stocks : BASE_TOKENIZED_STOCKS;
            const pinnedSet = new Set(builderPinned);
            const visibleStocks =
              builderView === "selected-only"
                ? baseList.filter((s) => (customWeights[s.symbol] || 0) > 0)
                : builderView === "selected-first"
                ? [...baseList.filter((s) => pinnedSet.has(s.symbol)), ...baseList.filter((s) => !pinnedSet.has(s.symbol))]
                : baseList;

            if (visibleStocks.length === 0) {
              return (
                <div className="rounded-xl border border-dashed border-slate-800 bg-[#070b14] p-5 text-center text-xs text-slate-400 space-y-2">
                  <p>No stocks selected above 0% right now.</p>
                  <button
                    type="button"
                    onClick={() => setBuilderView("all")}
                    className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-white hover:border-[#4C6FFF] cursor-pointer"
                  >
                    Show all 10 stocks
                  </button>
                </div>
              );
            }

            return (
              <div className={`grid grid-cols-1 gap-3 ${hasRegistry ? "" : "xl:grid-cols-2"}`}>
                {visibleStocks.map((stock) => {
                  const weightBps = customWeights[stock.symbol] || 0;
                  const nav = "navPrice" in stock ? (stock as LiveTokenizedStock).navPrice : null;
                  const isActive = weightBps > 0;
                  return (
                    <div
                      key={stock.symbol}
                      className={`rounded-xl border bg-[#070b14] p-3 flex items-center justify-between gap-3 sm:gap-4 transition ${
                        isActive ? "border-[#4C6FFF]/60" : "border-slate-800/80 opacity-85"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 w-28 sm:w-44 shrink-0">
                        <img
                          src={stock.logoUrl}
                          alt={stock.companyName}
                          className="h-8 w-8 rounded-full border border-slate-700 bg-slate-900 object-cover shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-bold text-white">{stock.symbol}</span>
                            {nav !== null && (
                              <span className="font-mono text-[11px] text-slate-400">${nav.toFixed(0)}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">{stock.companyName}</div>
                        </div>
                      </div>

                      <input
                        type="range"
                        min={0}
                        max={10000}
                        step={100}
                        value={weightBps}
                        onChange={(e) =>
                          setCustomWeights((prev) => ({
                            ...prev,
                            [stock.symbol]: Number(e.target.value),
                          }))
                        }
                        className="flex-1 min-w-0 accent-[#4C6FFF] cursor-pointer"
                        aria-label={`${stock.symbol} weight`}
                      />

                      <div className="w-16 sm:w-28 shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-xs font-bold text-white">
                        {(weightBps / 100).toFixed(1)}%
                        <span className="hidden sm:inline text-[10px] font-normal text-slate-400">
                          {" "}({weightBps} bps)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <div id="builder-actions" className="pt-2 border-t border-slate-800 scroll-mt-40">{amountControl}</div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">
              Total Weight:{" "}
              <strong
                className={`font-mono ${
                  totalCustomWeightBps === 10000 ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {totalCustomWeightBps} / 10,000 bps ({(totalCustomWeightBps / 100).toFixed(2)}%)
              </strong>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={
                  totalCustomWeightBps === 10000
                    ? `https://x.com/intent/tweet?text=${encodeURIComponent(
                        `My tokenized stock index [${customIndexTicker}] (${customIndexName}) on @base, built with MAXXAGENT:\n${Object.entries(
                          customWeights
                        )
                          .filter(([, w]) => w > 0)
                          .slice(0, 5)
                          .map(([s, w]) => `• $${s}: ${(w / 100).toFixed(0)}%`)
                          .join("\n")}\n\nBuy the same index: ${publicSiteUrl}/?${basketToQuery(customWeights)}\n\nNot financial advice. #StocksMaxxing @buildonbase`
                      )}`
                    : undefined
                }
                aria-disabled={totalCustomWeightBps !== 10000}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2.5 text-xs font-bold text-slate-200 transition ${
                  totalCustomWeightBps === 10000 ? "hover:border-blue-400 hover:text-white" : "opacity-50 pointer-events-none"
                }`}
              >
                <img src="/logos/brands/x.svg" alt="X" className="h-3.5 w-3.5" />
                Share Index on X
              </a>
              <button
                onClick={() => copyToClipboard(shareLinkFor(customWeights), "share-index")}
                disabled={totalCustomWeightBps !== 10000}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 px-4 py-2.5 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-white disabled:opacity-50 transition cursor-pointer"
                title="Copy a link that opens this index for anyone"
              >
                <Copy className="h-4 w-4" />
                {copiedKey === "share-index" ? "Link copied!" : "Copy share link"}
              </button>
              <button
                onClick={() =>
                  buyStocks(
                    Object.entries(customWeights)
                      .filter(([, w]) => w > 0)
                      .map(([sym, w]) => ({
                        symbol: sym,
                        b20Address: BASE_TOKENIZED_STOCKS.find((s) => s.symbol === sym)?.b20Address ?? "",
                        usd: Math.floor(((basketUsd * w) / Math.max(1, totalCustomWeightBps)) * 100) / 100,
                        payWith: basketPayWith,
                      })),
                    customIndexTicker
                  )
                }
                disabled={basketPending || totalCustomWeightBps !== 10000 || basketUsd < MIN_BUY_USD}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
              >
                <Zap className="h-4 w-4" />
                {basketPending ? basketStatus || "Working…" : `Buy for $${basketUsd} ${payLabel}`}
              </button>
              {hasRegistry && (
                <button
                  onClick={() =>
                    publishIndexOnchain(
                      customIndexName,
                      customIndexTicker,
                      Object.entries(customWeights).map(([sym, w]) => ({
                        b20Address: BASE_TOKENIZED_STOCKS.find((s) => s.symbol === sym)?.b20Address ?? "",
                        weightBps: w,
                      }))
                    )
                  }
                  disabled={txPending || !hasRegistry || totalCustomWeightBps !== 10000}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#4C6FFF] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-[#4C6FFF]/30 hover:bg-[#3D5BEA] disabled:opacity-50 transition cursor-pointer"
                  title={hasRegistry ? "Publish to StockMaxxIndexRegistry" : "Index registry not deployed yet"}
                >
                  <Layers className="h-4 w-4" />
                  {txPending ? publishStatus || "Confirm in wallet…" : "Publish onchain"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Onchain index registry: published indexes anyone can buy */}
        {hasRegistry && (
          <div className="lg:col-span-5 self-start rounded-3xl border border-slate-800 bg-gradient-to-b from-[#0d1428] to-[#0b1120] p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-[#4C6FFF]/40 bg-[#4C6FFF]/15">
                  <Layers className="h-5 w-5 text-blue-300" />
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-base font-bold text-white">
                    Published indexes
                    {publishedIndexes.length > 0 && (
                      <span className="rounded-full bg-[#4C6FFF]/20 px-2 py-0.5 font-mono text-[11px] text-blue-200">{publishedIndexes.length}</span>
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-400">Onchain baskets anyone can buy in one flow</p>
                </div>
              </div>
              <button
                onClick={loadPublishedIndexes}
                className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white cursor-pointer"
                title="Refresh"
                aria-label="Refresh published indexes"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${indexesStatus === "Loading…" ? "animate-spin" : ""}`} />
              </button>
            </div>

            <a
              href={`https://basescan.org/address/${registryAddress}#code`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-[11px] text-slate-300 hover:border-emerald-400/50"
            >
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
                Registry verified on BaseScan · holds no funds, no fees
              </span>
              <ExternalLink className="h-3 w-3 text-slate-500" />
            </a>

            <div className="rounded-2xl border border-slate-800 bg-[#070b14] p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sort by</span>
                <div className="inline-flex rounded-lg border border-slate-700 bg-[#040814] p-0.5 text-[10px]" role="group" aria-label="Sort published indexes">
                  {(
                    [
                      { id: "volume", label: "Volume" },
                      { id: "buys", label: "Buys" },
                      { id: "newest", label: "Newest" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setIndexSort(opt.id)}
                      aria-pressed={indexSort === opt.id}
                      className={`rounded px-2 py-0.5 font-semibold transition cursor-pointer ${
                        indexSort === opt.id ? "bg-[#4C6FFF] text-white" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Amount per buy</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[5, 10, 20, 50, 100].map((v) => (
                  <button
                    key={v}
                    onClick={() => setBasketUsd(v)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-bold cursor-pointer ${
                      basketUsd === v ? "border-emerald-400 bg-emerald-500/15 text-emerald-200" : "border-slate-700 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    ${v}
                  </button>
                ))}
                <span className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">$</span>
                  <UsdAmountInput
                    value={basketUsd}
                    onChange={setBasketUsd}
                    min={MIN_BUY_USD}
                    className="w-20 rounded-lg border border-slate-700 bg-[#050811] py-1 pl-5 pr-1.5 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                    ariaLabel="Amount per index buy in USD"
                  />
                </span>
                <span className="sm:ml-auto">{payToggle}</span>
              </div>
            </div>

            {publishedIndexes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 p-5 text-center text-xs text-slate-400">
                {indexesStatus === "Loading…"
                  ? "Loading published indexes…"
                  : indexesStatus && !/published/.test(indexesStatus)
                  ? `Could not load indexes: ${indexesStatus}`
                  : "No indexes published yet — publish the first one."}
              </div>
            ) : (
              <div className="space-y-3">
                {rankedIndexes.map((ix) => (
                  <div
                    key={ix.id}
                    className="rounded-2xl border border-slate-800 bg-gradient-to-br from-[#101a33] to-[#070b14] p-4 space-y-3 transition hover:border-[#4C6FFF]/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex shrink-0 -space-x-2 py-0.5 pl-0.5">
                          {ix.constituents.slice(0, 4).map((c) => (
                            <img
                              key={c.b20Address}
                              src={STOCK_LOGO_MAP[c.symbol]}
                              alt=""
                              className="h-8 w-8 rounded-full bg-slate-900 object-cover maxx-avatar-ring"
                            />
                          ))}
                        </div>
                        <div className="min-w-0">
                          <a href={`/index/${ix.id}`} className="block text-sm font-bold leading-snug text-white hover:text-cyan-300 line-clamp-2">
                            {ix.name}
                          </a>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span className="rounded bg-[#4C6FFF]/20 px-1.5 py-0.5 font-mono font-bold text-blue-200">{ix.ticker}</span>
                            <span className="font-mono text-slate-500">
                              #{ix.id} · by {ix.creator.slice(0, 6)}…{ix.creator.slice(-4)}
                            </span>
                            {indexBuys && indexBuys[ix.id] && (
                              <span
                                className="rounded px-1.5 py-0.5 font-semibold bg-emerald-500/15 text-emerald-200"
                                title="Counted from onchain swaps that match this index's stocks and weights (team test wallet excluded)"
                              >
                                {`${indexBuys[ix.id].buys} ${indexBuys[ix.id].buys === 1 ? "buy" : "buys"} · $${indexBuys[ix.id].volumeUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="hidden sm:inline-flex shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        Onchain
                      </span>
                    </div>

                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      {ix.constituents.map((c) => (
                        <div
                          key={c.b20Address}
                          style={{ width: `${c.weightBps / 100}%`, backgroundColor: STOCK_COLOR_MAP[c.symbol] || "#4C6FFF" }}
                          title={`${c.symbol} ${(c.weightBps / 100).toFixed(1)}%`}
                        />
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
                      {ix.constituents.map((c) => (
                        <div key={c.b20Address} className="flex items-center gap-1.5 text-[11px]">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: STOCK_COLOR_MAP[c.symbol] || "#4C6FFF" }} />
                          <span className="font-mono text-slate-200">{c.symbol}</span>
                          <span className="ml-auto font-mono text-slate-400">{(c.weightBps / 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() =>
                          buyStocks(
                            ix.constituents.map((c) => ({
                              symbol: c.symbol,
                              b20Address: c.b20Address,
                              usd: Math.floor(((basketUsd * c.weightBps) / 10000) * 100) / 100,
                              payWith: basketPayWith,
                            })),
                            ix.ticker
                          )
                        }
                        disabled={basketPending || basketUsd < MIN_BUY_USD}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
                      >
                        <Zap className="h-3.5 w-3.5" />
                        {basketPending ? basketStatus || "Working…" : `Buy $${basketUsd} ${payLabel}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const enc = new TextEncoder();
                          const clampUtf8 = (s: string, max: number) => {
                            let out = "";
                            for (const ch of s.trim()) {
                              if (enc.encode(out + ch).length > max) break;
                              out += ch;
                            }
                            return out;
                          };
                          const map: Record<string, number> = {};
                          ix.constituents.forEach((c) => {
                            map[c.symbol] = c.weightBps;
                          });
                          const baseName = ix.name.replace(/\s*\(Remix\)$/i, "").trim();
                          setCustomIndexName(`${clampUtf8(baseName, 56)} (Remix)`);
                          setCustomIndexTicker(clampUtf8(ix.ticker, 16));
                          applyCustomWeights(map);
                          document.getElementById("index-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                        className="rounded-xl border border-slate-700 px-3 py-2.5 text-xs font-semibold text-cyan-200 hover:border-cyan-400/60 hover:text-white cursor-pointer"
                        title="Load these stocks and weights into the builder"
                      >
                        Fork
                      </button>
                      <a
                        href={`/index/${ix.id}`}
                        className="rounded-xl border border-slate-700 px-3 py-2.5 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-white"
                      >
                        Details
                      </a>
                      <button
                        onClick={() => copyToClipboard(`${window.location.origin}/index/${ix.id}`, `index-link-${ix.id}`)}
                        className="grid h-[38px] w-[38px] place-items-center rounded-xl border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white cursor-pointer"
                        title="Copy link"
                        aria-label={`Copy link to ${ix.ticker}`}
                      >
                        {copiedKey === `index-link-${ix.id}` ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
