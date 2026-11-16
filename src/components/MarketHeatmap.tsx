"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MaxxLoader } from "@/components/MaxxLoader";
import Link from "next/link";
import { Moon } from "lucide-react";
import { nextOpenUnix, usMarketStatus } from "@/lib/marketHours";
import { earningsLabel, recentEarnings, type EarningsMark } from "@/lib/earnings";

interface HeatStock {
  symbol: string;
  companyName: string;
  logoUrl: string;
  dexPrice24_7: number;
  navPrice: number;
  change24hPct: number;
  onchainMarketCapUsd: number;
  dexVolume24hUsd?: number;
  /** DEX price vs the Chainlink NAV, percent */
  weekendGapPct?: number;
  /** "onchain-nav-model" when there is no live DEX quote (then there is no real gap to show) */
  dexPriceSource?: string;
}
type SizeBy = "value" | "volume";
type ColorBy = "change" | "gap";
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

/** A tile: a link to the stock page, or a plain box where those pages aren't available */
function Tile({ href, children, ...rest }: { href?: string; title: string; className: string; style: React.CSSProperties; children: React.ReactNode }) {
  return href ? (
    <Link href={href} {...rest}>
      {children}
    </Link>
  ) : (
    <div {...rest}>{children}</div>
  );
}

/** Red for a fall, green for a rise, deeper with the size of the move (full colour at ±`full`%: 3 for 24h moves, 1.5 for gaps vs NAV) */
function heat(pct: number, full = 3): string {
  const t = Math.min(Math.abs(pct) / full, 1);
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
export function MarketHeatmap({ stocks, updatedAt, links = true }: { stocks: HeatStock[]; updatedAt?: string; links?: boolean }) {
  const [sizeBy, setSizeBy] = useState<SizeBy>("value");
  const [colorBy, setColorBy] = useState<ColorBy>("change");
  // Recent earnings reports (SEC 8-K item 2.02) from the cached news feed; not on the read-only preview
  const [earnings, setEarnings] = useState<Record<string, EarningsMark>>({});
  useEffect(() => {
    if (!links) return;
    let off = false;
    fetch("/api/news")
      .then((r) => r.json())
      .then((d) => !off && d?.ok && Array.isArray(d.items) && setEarnings(recentEarnings(d.items)))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [links]);
  // The US session, from the viewer's clock (client only, refreshed every minute)
  const [session, setSession] = useState<{ open: boolean; label: string; next: number | null } | null>(null);
  useEffect(() => {
    const tick = () => {
      const st = usMarketStatus();
      setSession({ open: st.state === "open", label: st.label, next: st.state === "open" ? null : nextOpenUnix() });
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);
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

  const live = (s: HeatStock) => s.dexPriceSource !== "onchain-nav-model";
  const valueOf = (s: HeatStock) => (colorBy === "gap" ? (live(s) ? s.weekendGapPct ?? 0 : 0) : s.change24hPct);
  const up = stocks.filter((s) => valueOf(s) > 0.05).length;
  const down = stocks.filter((s) => valueOf(s) < -0.05).length;
  const until = (t: number) => {
    const m = Math.max(0, Math.round((t * 1000 - Date.now()) / 60_000));
    return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  return (
    <section className="glass-panel rounded-3xl p-4 sm:p-6 space-y-3" data-testid="market-heatmap" aria-label="Market heatmap">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Market heatmap</h2>
          <p className="text-[11px] text-slate-400">
            {colorBy === "gap" ? "DEX price vs the last Chainlink NAV" : "24h change of the DEX price"} ·{" "}
            <span className="text-emerald-300">
              {up} {colorBy === "gap" ? "above" : "up"}
            </span>{" "}
            · <span className="text-rose-300">{down} {colorBy === "gap" ? "below" : "down"}</span> · tile size ={" "}
            {sizeBy === "value" ? "value of the tokens on Base (supply × NAV)" : "24h DEX volume"}
            {updatedAt && links ? ` · updated ${new Date(updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}, refreshes every minute` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <div className="flex rounded-lg border border-slate-800 bg-[#050811] p-0.5 text-[11px]" aria-label="Colour">
          {(["change", "gap"] as ColorBy[]).map((k) => (
            <button
              key={k}
              onClick={() => setColorBy(k)}
              aria-pressed={colorBy === k}
              className={`rounded-md px-2.5 py-1 font-bold cursor-pointer ${colorBy === k ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {k === "change" ? "24h change" : "DEX vs NAV"}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-slate-800 bg-[#050811] p-0.5 text-[11px]" aria-label="Tile size">
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
      </div>

      {session && !session.open && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-100" data-testid="market-closed-strip">
          <Moon className="h-3.5 w-3.5 text-indigo-300" />
          <strong>Wall Street is closed. These tokens aren&apos;t.</strong>
          <span className="text-indigo-200/80">
            {session.label}
            {session.next
              ? ` · opens ${new Date(session.next * 1000).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })} New York (in ${until(session.next)})`
              : ""}{" "}
            · DEX prices keep moving 24/7 on Base, the NAV waits for the next close.
          </span>
          {colorBy !== "gap" && (
            <button onClick={() => setColorBy("gap")} className="ml-auto rounded-md border border-indigo-300/40 px-2 py-0.5 font-bold text-indigo-100 hover:bg-indigo-500/20 cursor-pointer">
              Show the gap vs NAV
            </button>
          )}
        </div>
      )}

      <div ref={ref} className="relative w-full overflow-hidden rounded-2xl bg-[#050811]" style={{ height: height || 320 }}>
        {tiles.map(({ s, r, size }) => {
          const m = Math.min(r.w, r.h);
          const big = m > 150;
          const logo = m > 70;
          const text = m > 34;
          const v = valueOf(s);
          const pct = colorBy === "gap" && !live(s) ? "no quote" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
          return (
            <Tile
              key={s.symbol}
              href={links ? `/stock/${s.symbol}` : undefined}
              title={`${s.companyName} (${s.symbol}) · ${s.change24hPct >= 0 ? "+" : ""}${s.change24hPct.toFixed(2)}% 24h · ${live(s) ? `${(s.weekendGapPct ?? 0).toFixed(2)}% vs NAV` : "no live DEX quote"} · DEX $${s.dexPrice24_7.toFixed(2)} · NAV $${s.navPrice.toFixed(2)} · ${
                sizeBy === "value" ? `onchain value ${usdShort(size)}` : `24h volume ${usdShort(size)}`
              }`}
              className="absolute flex flex-col items-center justify-center gap-1 border border-[#02050c] text-center text-white transition-[filter] hover:brightness-125"
              style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: heat(v, colorBy === "gap" ? 1.5 : 3), transition: "left .4s, top .4s, width .4s, height .4s" }}
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
                  {colorBy === "gap" && m > 60 && <span className="text-[10px] uppercase tracking-wider text-white/70">vs NAV</span>}
                  {big && <span className="text-[11px] text-white/70">{usdShort(size)}</span>}
                  {earnings[s.symbol] && m > 60 && (
                    <span className="mt-0.5 rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-950" title={earningsLabel(earnings[s.symbol])}>
                      Earnings
                    </span>
                  )}
                </>
              )}
            </Tile>
          );
        })}
        {!tiles.length && (
          <div className="absolute inset-0 grid place-items-center">
            <MaxxLoader label="Loading the market…" />
          </div>
        )}
      </div>
      <p className="text-[10px] text-slate-500">
        {colorBy === "gap"
          ? "Gap between the Base DEX price (trades 24/7) and the last Chainlink NAV (the stock's official close). While the US market is closed, a gap can simply reflect news since that close."
          : "24h change from the Base DEX pool of each token (it trades 24/7, also when US markets are closed)."}
        {links ? " Tap a tile for the stock page." : ""} Not financial advice.
      </p>
    </section>
  );
}
