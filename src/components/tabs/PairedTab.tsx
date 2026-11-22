"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, RefreshCw, Zap } from "lucide-react";
import { STOCK_COLOR_MAP, STOCK_LOGO_MAP } from "@/components/PortfolioDonutChart";
import type { PairedToken } from "@/app/api/paired/route";
import type { LiveTokenizedStock } from "@/lib/tokenizedStocks";

type Resp = {
  ok: boolean;
  error?: string;
  updatedAt?: string;
  poolsScanned?: number;
  rules?: { minLiquidityUsd: number; minAgeDays: number; minVolumeIfYoungUsd: number };
  tokens?: PairedToken[];
};

const usdShort = (n: number) =>
  n >= 1e9
    ? `$${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
      ? `$${(n / 1e6).toFixed(2)}M`
      : n >= 1e4
        ? `$${Math.round(n / 1e3)}K`
        : n >= 1e3
          ? `$${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`
          : `$${n.toFixed(0)}`;
// Plain decimals with 3 significant digits, never scientific notation ($0.000000189, not $1.89e-7)
const price = (n: number) =>
  n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(Math.min(14, Math.max(4, 2 - Math.floor(Math.log10(n)))))}`;
const age = (ms: number | null) => {
  if (!ms) return "—";
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d < 1 ? "<1 day" : d < 60 ? `${d} days` : `${Math.floor(d / 30)} months`;
};
const DEX_NAMES: Record<string, string> = { uniswap: "Uniswap", aerodrome: "Aerodrome", aero: "Aerodrome", equalizer: "Equalizer", hydrex: "Hydrex", pancakeswap: "PancakeSwap", sushiswap: "SushiSwap" };

type Sort = "liquidity" | "volume";

/** The logo the token's team registered on DexScreener, or its initials when there is none or it fails to load */
function TokenLogo({ symbol, src }: { symbol: string; src?: string | null }) {
  const [broken, setBroken] = useState(false);
  const cls = "h-8 w-8 shrink-0 rounded-full border border-slate-700 bg-slate-900";
  if (src && !broken)
    return <img src={src} alt={`${symbol} logo`} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`${cls} object-cover`} />;
  return (
    <span className={`${cls} inline-flex items-center justify-center font-mono text-[11px] font-bold text-slate-200`}>
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}

export default function PairedTab({
  stocks = [],
  initialStock,
  onTrade,
}: {
  /** live stocks, for each paired stock's own 24h move next to the token's */
  stocks?: LiveTokenizedStock[];
  /** open filtered to one stock (from "See all" under a stock's chart, or ?pair=SPCXc) */
  initialStock?: string;
  /** buy the paired stock in the Swap panel (MAXXAGENT routes the stock, never the token) */
  onTrade?: (symbol: string) => void;
}) {
  const [data, setData] = useState<Resp | null>(null);
  const [sort, setSort] = useState<Sort>("liquidity");
  const [stock, setStock] = useState<string>(initialStock || "all");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (initialStock) return;
    const fromUrl = new URLSearchParams(window.location.search).get("pair");
    if (fromUrl && /^[A-Za-z]{1,8}c$/.test(fromUrl)) setStock(fromUrl);
  }, [initialStock]);
  useEffect(() => {
    if (initialStock) setStock(initialStock);
  }, [initialStock]);
  const stockBySymbol = useMemo(() => new Map(stocks.map((s) => [s.symbol, s])), [stocks]);

  useEffect(() => {
    let off = false;
    setData(null);
    fetch("/api/paired")
      .then((r) => r.json())
      .then((d: Resp) => !off && setData(d))
      .catch(() => !off && setData({ ok: false, error: "Paired tokens are unavailable right now." }));
    return () => {
      off = true;
    };
  }, [reload]);

  const tokens = useMemo(() => data?.tokens ?? [], [data]);
  const stocksPresent = useMemo(() => [...new Set(tokens.map((t) => t.stock))], [tokens]);
  const rows = useMemo(
    () =>
      tokens
        .filter((t) => stock === "all" || t.stock === stock)
        .sort((a, b) => (sort === "volume" ? b.volume24hUsd - a.volume24hUsd : b.liquidityUsd - a.liquidityUsd)),
    [tokens, stock, sort]
  );

  return (
    <div className="space-y-4" data-testid="paired-tab">
      <section className="glass-panel rounded-3xl p-4 sm:p-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-white">Tokens paired with tokenized stocks</h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
              Meme and community tokens on Base whose pool trades against one of the 10 tokenized stocks (for example a token
              paired with SPCXc). Only pools with at least {usdShort(data?.rules?.minLiquidityUsd ?? 10_000)} of liquidity that are
              over {data?.rules?.minAgeDays ?? 7} days old or traded {usdShort(data?.rules?.minVolumeIfYoungUsd ?? 1_000)}+ in 24h
              are listed; stablecoins, ETH/BTC and other wrappers of the same stocks are left out.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-white cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Third-party tokens, listed only because their pool exists onchain. Not verified, reviewed or endorsed by MAXXAGENT, and
            not tradable here: MAXXAGENT only routes the 10 tokenized stocks. Meme tokens are extremely risky and can lose all value.
            Not financial advice.
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {["all", ...stocksPresent].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStock(s)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold cursor-pointer ${
                  stock === s ? "border-blue-400 bg-[#4C6FFF] text-white" : "border-slate-800 bg-[#050a18] text-slate-300 hover:text-white"
                }`}
              >
                {s !== "all" && STOCK_LOGO_MAP[s] && <img src={STOCK_LOGO_MAP[s]} alt="" className="h-3.5 w-3.5 rounded-full" />}
                {s === "all" ? "All stocks" : s}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-xl border border-slate-800 bg-[#040814] p-0.5 text-[11px] font-semibold">
            {(["liquidity", "volume"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSort(k)}
                className={`rounded-lg px-2.5 py-1 cursor-pointer ${sort === k ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
              >
                {k === "liquidity" ? "Liquidity" : "24h volume"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {!data ? (
        <div className="rounded-2xl border border-slate-800 p-6 text-center text-xs text-slate-400">Reading pools from DexScreener…</div>
      ) : !data.ok ? (
        <div className="rounded-2xl border border-slate-800 p-6 text-center text-xs text-slate-400">{data.error}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
          No token passes the liquidity rules right now.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {rows.map((t, i) => (
            <div key={t.pairAddress} className="rounded-2xl border border-slate-800 bg-[#070b14] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="font-mono text-[11px] text-slate-500 w-5 shrink-0">#{i + 1}</span>
                  <TokenLogo symbol={t.token.symbol} src={t.token.logoUrl} />
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-bold text-white">${t.token.symbol}</div>
                    <div className="truncate text-[11px] text-slate-400">{t.token.name}</div>
                  </div>
                </div>
                <Link
                  href={`/stock/${t.stock}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] font-bold text-white hover:bg-slate-800/60"
                  style={{ borderColor: `${STOCK_COLOR_MAP[t.stock] || "#4C6FFF"}88` }}
                  title={`Pool pairs $${t.token.symbol} with ${t.stock}: open the ${t.stock} stock page`}
                >
                  ↔ {STOCK_LOGO_MAP[t.stock] && <img src={STOCK_LOGO_MAP[t.stock]} alt="" className="h-3.5 w-3.5 rounded-full" />}
                  {t.stock}
                </Link>
              </div>
              {(() => {
                // The token is priced in the stock, so its dollar price carries the stock's move too: show both
                const st = stockBySymbol.get(t.stock);
                const stockChg = st && Number.isFinite(st.change24hPct) ? st.change24hPct : null;
                if (stockChg === null && t.priceChange24hPct === null) return null;
                const pct = (v: number) => (
                  <span className={v >= 0 ? "text-emerald-300" : "text-rose-300"}>
                    {v >= 0 ? "+" : ""}
                    {v.toFixed(1)}%
                  </span>
                );
                return (
                  <div className="rounded-lg border border-slate-800/80 bg-[#050914] px-2.5 py-1.5 font-mono text-[11px] text-slate-400">
                    24h: ${t.token.symbol} {t.priceChange24hPct !== null ? pct(t.priceChange24hPct) : "—"} · {t.stock}{" "}
                    {stockChg !== null ? pct(stockChg) : "—"}
                    <span className="font-sans text-[10px] text-slate-500"> · priced in {t.stock}, so it moves with it too</span>
                  </div>
                );
              })()}
              <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-[11px]">
                <div>
                  <div className="font-sans text-[10px] text-slate-500">Liquidity</div>
                  <div className="font-bold text-white">{usdShort(t.liquidityUsd)}</div>
                </div>
                <div>
                  <div className="font-sans text-[10px] text-slate-500">24h volume</div>
                  <div className="font-bold text-white">{usdShort(t.volume24hUsd)}</div>
                </div>
                <div>
                  <div className="font-sans text-[10px] text-slate-500">Price · 24h</div>
                  <div className="font-bold text-white">
                    {t.priceUsd !== null ? price(t.priceUsd) : "—"}
                    {t.priceChange24hPct !== null && (
                      <span className={`ml-1 ${t.priceChange24hPct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                        {t.priceChange24hPct >= 0 ? "+" : ""}
                        {t.priceChange24hPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                <span>
                  {DEX_NAMES[t.dex] ?? t.dex} · pool age {age(t.createdAt)}
                  {t.fdvUsd ? ` · FDV ${usdShort(t.fdvUsd)}` : ""}
                </span>
                <span className="flex items-center gap-2.5">
                  {onTrade && (
                    <button
                      type="button"
                      onClick={() => onTrade(t.stock)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#4C6FFF]/40 bg-[#4C6FFF]/15 px-2 py-0.5 font-semibold text-blue-200 hover:bg-[#4C6FFF]/30 cursor-pointer"
                      title={`Buy ${t.stock} itself in the Swap panel (MAXXAGENT routes the stock, not $${t.token.symbol})`}
                    >
                      <Zap className="h-3 w-3" /> Trade {t.stock}
                    </button>
                  )}
                  <a
                    href={`https://dexscreener.com/base/${t.pairAddress}`}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1 font-semibold text-cyan-300 hover:text-white"
                  >
                    Pool <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href={`https://basescan.org/token/${t.token.address}`}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1 font-semibold text-cyan-300 hover:text-white"
                  >
                    Token <ExternalLink className="h-3 w-3" />
                  </a>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {data?.ok && (
        <p className="text-[10px] text-slate-500">
          Source: DexScreener public API ({data.poolsScanned ?? 0} Base pools with the 10 stocks scanned) · updated{" "}
          {data.updatedAt ? new Date(data.updatedAt).toISOString().slice(11, 16) : "—"} UTC, refreshed every 10 minutes.
        </p>
      )}
    </div>
  );
}
