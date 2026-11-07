"use client";

import { useEffect, useState } from "react";
import { MarketStatus } from "./MarketStatus";

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
  oracleAgeMinutes: number;
  isOracleStale: boolean;
}
type Point = [number, number];

const usd = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const compact = (n: number) => `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n)}`;
const ago = (m: number) => (m < 60 ? `${Math.round(m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`);
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;

/** Live numbers + 7-day NAV vs DEX chart for one stock (public data only, no wallet). */
export function StockLive({ symbol, color }: { symbol: string; color: string }) {
  const [live, setLive] = useState<Live | null>(null);
  const [failed, setFailed] = useState(false);
  const [hist, setHist] = useState<{ nav: Point[]; dex: Point[] } | null>(null);

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
      .then((d) => !off && d?.ok && setHist({ nav: d.nav || [], dex: d.dex || [] }))
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
      <Chart hist={hist} color={color} />
    </div>
  );
}

function Chart({ hist, color }: { hist: { nav: Point[]; dex: Point[] } | null; color: string }) {
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
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full" preserveAspectRatio="none" role="img" aria-label="7-day price chart">
        {hist.nav.length > 1 && <path d={path(hist.nav)} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        {hist.dex.length > 1 && <path d={path(hist.dex)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
        <span>{usd(lo)}</span>
        <span>{usd(hi)}</span>
      </div>
    </div>
  );
}
