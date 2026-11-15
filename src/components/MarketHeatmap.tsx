"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

interface HeatStock {
  symbol: string;
  companyName: string;
  logoUrl: string;
  dexPrice24_7: number;
  navPrice: number;
  change24hPct: number;
  onchainMarketCapUsd: number;
  dexVolume24hUsd?: number;
}
type SizeBy = "value" | "volume";
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk): lays the values out in rows that keep each tile close to a
 * square. `values` must be sorted largest first; returns one rect per value, in the same order.
 */
function squarify(values: number[], box: Rect): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return values.map(() => ({ ...box, w: 0, h: 0 }));
  const scale = (box.w * box.h) / total;
  const areas = values.map((v) => v * scale);
  const out: Rect[] = [];
  let rest = { ...box };
  let i = 0;
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  while (i < areas.length) {
    const side = Math.min(rest.w, rest.h);
    const row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) row.push(areas[j++]);
    const sum = row.reduce((a, b) => a + b, 0);
    if (rest.w >= rest.h) {
      // a column on the left
      const colW = sum / rest.h;
      let y = rest.y;
      for (const a of row) {
        out.push({ x: rest.x, y, w: colW, h: a / colW });
        y += a / colW;
      }
      rest = { x: rest.x + colW, y: rest.y, w: rest.w - colW, h: rest.h };
    } else {
      // a row on top
      const rowH = sum / rest.w;
      let x = rest.x;
      for (const a of row) {
        out.push({ x, y: rest.y, w: a / rowH, h: rowH });
        x += a / rowH;
      }
      rest = { x: rest.x, y: rest.y + rowH, w: rest.w, h: rest.h - rowH };
    }
    i = j;
  }
  return out;
}

/** Red for a fall, green for a rise, deeper with the size of the move (full colour at ±3%) */
function heat(pct: number): string {
  const t = Math.min(Math.abs(pct) / 3, 1);
  const mix = (a: number[], b: number[]) => `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(",")})`;
  if (Math.abs(pct) < 0.05) return "rgb(30,41,59)";
  return pct < 0 ? mix([60, 22, 34], [225, 29, 72]) : mix([18, 52, 40], [16, 185, 129]);
}

const usdShort = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;

/**
 * Market heatmap of the supported tokenized stocks: tile size = onchain value (tokens on Base × NAV) or 24h DEX
 * volume, colour = 24h change of the DEX price. Each tile opens the stock page.
 */
export function MarketHeatmap({ stocks, updatedAt }: { stocks: HeatStock[]; updatedAt?: string }) {
  const [sizeBy, setSizeBy] = useState<SizeBy>("value");
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const height = width ? Math.max(300, Math.min(520, width < 640 ? width * 1.1 : width * 0.5)) : 0;

  const tiles = useMemo(() => {
    const sizeOf = (s: HeatStock) => (sizeBy === "value" ? s.onchainMarketCapUsd : s.dexVolume24hUsd ?? 0);
    const list = stocks.filter((s) => sizeOf(s) > 0).sort((a, b) => sizeOf(b) - sizeOf(a));
    if (!width || !list.length) return [];
    const rects = squarify(list.map(sizeOf), { x: 0, y: 0, w: width, h: height });
    return list.map((s, i) => ({ s, r: rects[i], size: sizeOf(s) }));
  }, [stocks, sizeBy, width, height]);

  const up = stocks.filter((s) => s.change24hPct > 0.05).length;
  const down = stocks.filter((s) => s.change24hPct < -0.05).length;

  return (
    <section className="glass-panel rounded-3xl p-4 sm:p-6 space-y-3" data-testid="market-heatmap" aria-label="Market heatmap">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Market heatmap</h2>
          <p className="text-[11px] text-slate-400">
            24h change of the DEX price · <span className="text-emerald-300">{up} up</span> ·{" "}
            <span className="text-rose-300">{down} down</span> · tile size ={" "}
            {sizeBy === "value" ? "value of the tokens on Base (supply × NAV)" : "24h DEX volume"}
            {updatedAt ? ` · updated ${new Date(updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}, refreshes every minute` : ""}
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-800 bg-[#050811] p-0.5 text-[11px]">
          {(["value", "volume"] as SizeBy[]).map((k) => (
            <button
              key={k}
              onClick={() => setSizeBy(k)}
              aria-pressed={sizeBy === k}
              className={`rounded-md px-2.5 py-1 font-bold cursor-pointer ${sizeBy === k ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {k === "value" ? "Onchain value" : "24h volume"}
            </button>
          ))}
        </div>
      </div>

      <div ref={ref} className="relative w-full overflow-hidden rounded-2xl bg-[#050811]" style={{ height: height || 320 }}>
        {tiles.map(({ s, r, size }) => {
          const m = Math.min(r.w, r.h);
          const big = m > 150;
          const logo = m > 70;
          const text = m > 34;
          const pct = `${s.change24hPct >= 0 ? "+" : ""}${s.change24hPct.toFixed(2)}%`;
          return (
            <Link
              key={s.symbol}
              href={`/stock/${s.symbol}`}
              title={`${s.companyName} (${s.symbol}) · ${pct} 24h · DEX $${s.dexPrice24_7.toFixed(2)} · NAV $${s.navPrice.toFixed(2)} · ${
                sizeBy === "value" ? `onchain value ${usdShort(size)}` : `24h volume ${usdShort(size)}`
              }`}
              className="absolute flex flex-col items-center justify-center gap-1 border border-[#02050c] text-center text-white transition-[filter] hover:brightness-125"
              style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: heat(s.change24hPct), transition: "left .4s, top .4s, width .4s, height .4s" }}
            >
              {logo && (
                <img
                  src={s.logoUrl}
                  alt=""
                  className="rounded-full bg-white/90 p-0.5 shadow"
                  style={{ width: big ? Math.min(72, m * 0.28) : Math.min(40, m * 0.3), height: big ? Math.min(72, m * 0.28) : Math.min(40, m * 0.3) }}
                />
              )}
              {text && (
                <>
                  <span className="font-extrabold leading-none" style={{ fontSize: Math.max(11, Math.min(34, m * 0.16)) }}>
                    {s.symbol}
                  </span>
                  <span className="font-mono font-bold leading-none opacity-95" style={{ fontSize: Math.max(10, Math.min(28, m * 0.13)) }}>
                    {pct}
                  </span>
                  {big && <span className="text-[11px] text-white/70">{usdShort(size)}</span>}
                </>
              )}
            </Link>
          );
        })}
        {!tiles.length && <div className="absolute inset-0 grid place-items-center text-xs text-slate-500">Loading the market…</div>}
      </div>
      <p className="text-[10px] text-slate-500">
        24h change from the Base DEX pool of each token (it trades 24/7, also when US markets are closed). Tap a tile for the stock page. Not financial advice.
      </p>
    </section>
  );
}
