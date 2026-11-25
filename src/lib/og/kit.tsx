import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";
import { NextRequest } from "next/server";
import { GET as getStocks } from "@/app/api/stocks/route";
import { GET as getHistory } from "@/app/api/history/route";
import type { LiveTokenizedStock } from "@/lib/tokenizedStocks";

/**
 * Shared pieces for the share cards under /api/og (1200x630, or 1200x800 for Farcaster embeds).
 * Rendered with next/og (satori): flexbox only, inline styles, fonts must be TTF.
 * Live data is read in-process from the same routes the site uses and never blocks a card:
 * anything slower than LIVE_TIMEOUT_MS is left out and the card renders without it.
 */

export const OG_W = 1200;
export const UP = "#34d399";
export const DOWN = "#fb7185";
export const MUTED = "#8b97b5";
export const INK = "#eef2fb";
export const BG = "#04060d";
const LIVE_TIMEOUT_MS = 4500;

// ---------- fonts and logo (bundled in assets/og, licenses next to them) ----------
const asset = (f: string) => readFile(join(process.cwd(), "assets", "og", f));
let fontsP: Promise<{ name: string; data: Buffer; weight: 400 | 600 | 800 | 700; style: "normal" }[]> | null = null;
export function ogFonts() {
  fontsP ??= Promise.all([
    asset("PlusJakartaSans-Regular.ttf").then((data) => ({ name: "Jakarta", data, weight: 400 as const, style: "normal" as const })),
    asset("PlusJakartaSans-SemiBold.ttf").then((data) => ({ name: "Jakarta", data, weight: 600 as const, style: "normal" as const })),
    asset("PlusJakartaSans-ExtraBold.ttf").then((data) => ({ name: "Jakarta", data, weight: 800 as const, style: "normal" as const })),
    asset("JetBrainsMono-Bold.ttf").then((data) => ({ name: "Mono", data, weight: 700 as const, style: "normal" as const })),
  ]).catch((e) => {
    fontsP = null;
    throw e;
  });
  return fontsP;
}
let markP: Promise<string> | null = null;
export const ogMark = () => (markP ??= asset("mark.svg").then((b) => `data:image/svg+xml;base64,${b.toString("base64")}`));

/** Options for ImageResponse: size, fonts and CDN caching */
export async function ogOptions(height: number, maxAgeSec = 3600) {
  return {
    width: OG_W,
    height,
    fonts: await ogFonts(),
    headers: { "Cache-Control": `public, max-age=${Math.min(maxAgeSec, 3600)}, s-maxage=${maxAgeSec}, stale-while-revalidate=604800` },
  };
}

// ---------- formatting ----------
export const fmtPct = (v: number, digits = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}%`;
export const fmtUsd = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(2)}`;
export const signColor = (v: number) => (v >= 0 ? UP : DOWN);
/** "NVIDIA Corporation" -> "NVIDIA", "Space Exploration Technologies Corp." -> "SpaceX" */
export const shortCompany = (n: string) =>
  /^Space Exploration/.test(n) ? "SpaceX" : n.replace(/,?\s+(Inc\.?|Corporation|Corp\.?|Platforms Inc\.?|\.com Inc\.?)$/, "").replace(/\.com$/, "");

// ---------- live data ----------
function withTimeout<T>(p: Promise<T>, ms = LIVE_TIMEOUT_MS): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export type OgMarket = { stocks: LiveTokenizedStock[]; tvlUsd?: number; volume24hUsd?: number };
export function liveMarket(origin: string): Promise<OgMarket | null> {
  return withTimeout(
    (async () => {
      const res = await getStocks(new NextRequest(new URL("/api/stocks", origin)));
      if (!res.ok) return null;
      const j = await res.json();
      if (!Array.isArray(j?.stocks) || j.stocks.length === 0) return null;
      return { stocks: j.stocks as LiveTokenizedStock[], tvlUsd: j.totalBaseStocksTvlUsd, volume24hUsd: j.totalBaseDexVolume24hUsd };
    })()
  );
}

/** 7-day Chainlink NAV points [unixSec, price] for one stock, or null */
export function navHistory7d(origin: string, symbol: string): Promise<[number, number][] | null> {
  return withTimeout(
    (async () => {
      const res = await getHistory(new NextRequest(new URL(`/api/history?symbol=${encodeURIComponent(symbol)}&tf=7D&only=nav`, origin)));
      if (!res.ok) return null;
      const j = await res.json();
      const nav = Array.isArray(j?.nav) ? (j.nav as [number, number][]).filter((p) => Number.isFinite(p?.[1]) && p[1] > 0) : [];
      return nav.length >= 2 ? nav : null;
    })()
  );
}

/** Change over the series, in % */
export const seriesChangePct = (pts: [number, number][]) => (pts[pts.length - 1][1] / pts[0][1] - 1) * 100;

// ---------- shapes ----------
/**
 * Sparkline path. x is the sample index, so hours with the US market closed (flat NAV) don't stretch
 * the line; repeated prices are dropped and the line is lightly smoothed.
 */
export function sparkPaths(raw: [number, number][], w: number, h: number) {
  const ys = raw.filter((p, i) => i === 0 || p[1] !== raw[i - 1][1]).map((p) => p[1]);
  const step = Math.max(1, Math.floor(ys.length / 90)); // at most ~90 points
  const pts = ys.filter((_, i) => i % step === 0 || i === ys.length - 1);
  const smooth = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(pts.length - 1, i + 1)];
    return i === 0 || i === pts.length - 1 ? b : (a + 2 * b + c) / 4;
  });
  const min = Math.min(...smooth), max = Math.max(...smooth);
  // a tiny range would turn noise into a zigzag: keep at least 1.5% of the price as the vertical span
  const span = Math.max(max - min, ((min + max) / 2) * 0.015);
  const mid = (min + max) / 2;
  // keep room on the right and at the top/bottom for the end dot and its halo (r 16)
  const xw = w - 20, pad = 18;
  const P = smooth.map((y, i) => [(i / Math.max(1, smooth.length - 1)) * xw, h - pad - ((y - (mid - span / 2)) / span) * (h - 2 * pad)]);
  const line = P.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return { line, area: `${line} L${xw} ${h} L0 ${h} Z`, last: P[P.length - 1] as [number, number] };
}

/** Donut segments for weights in % (sum 100) */
export function donutPaths(pcts: number[], cx: number, cy: number, R: number, r: number) {
  let acc = 0;
  const gap = pcts.length > 1 ? 0.014 : 0;
  const pt = (rad: number, a: number) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
  return pcts.map((p) => {
    const a0 = (acc / 100) * 2 * Math.PI - Math.PI / 2;
    acc += p;
    const a1 = (acc / 100) * 2 * Math.PI - Math.PI / 2;
    if (p >= 99.99) return `M${pt(R, -Math.PI / 2)} A${R} ${R} 0 1 1 ${pt(R, Math.PI * 1.4999)} L${pt(r, Math.PI * 1.4999)} A${r} ${r} 0 1 0 ${pt(r, -Math.PI / 2)} Z`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${pt(R, a0 + gap)} A${R} ${R} 0 ${large} 1 ${pt(R, a1 - gap)} L${pt(r, a1 - gap)} A${r} ${r} 0 ${large} 0 ${pt(r, a0 + gap)} Z`;
  });
}

// ---------- building blocks ----------
/** Dark base with a faint grid and soft colored light; children are absolutely placed by the caller */
export function Frame({ height, glows, children }: { height: number; glows: { x: number; y: number; size: number; color: string }[]; children: ReactNode }) {
  return (
    <div style={{ position: "relative", display: "flex", width: OG_W, height, background: BG, color: INK, fontFamily: "Jakarta", overflow: "hidden" }}>
      {glows.map((g, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: g.x - g.size / 2,
            top: g.y - g.size / 2,
            width: g.size,
            height: g.size,
            borderRadius: g.size,
            background: `radial-gradient(circle, ${g.color} 0%, transparent 68%)`,
            display: "flex",
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: OG_W,
          height,
          display: "flex",
          backgroundImage: "linear-gradient(rgba(130,150,210,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(130,150,210,0.07) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div style={{ position: "absolute", top: 0, left: 0, width: OG_W, height, display: "flex", background: "radial-gradient(ellipse at 50% 120%, rgba(4,6,13,0.9) 0%, transparent 60%)" }} />
      {children}
    </div>
  );
}

export function Brand({ mark, size = 46 }: { mark: string; size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      { }
      <img src={mark} width={size} height={size} style={{ borderRadius: size * 0.26 }} alt="" />
      <div style={{ display: "flex", fontSize: size * 0.56, fontWeight: 800, letterSpacing: 1.6 }}>
        <span>MAXX</span>
        <span style={{ backgroundImage: "linear-gradient(90deg, #7c8bff, #3ad1e6 55%, #34d399)", backgroundClip: "text", color: "transparent" }}>AGENT</span>
      </div>
    </div>
  );
}

export function Chip({ children, color = "#cbd5e1", border = "rgba(148,163,184,0.24)", bg = "rgba(15,23,42,0.66)", mono, size = 17, dot }: { children: ReactNode; color?: string; border?: string; bg?: string; mono?: boolean; size?: number; dot?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "8px 16px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        color,
        fontSize: size,
        fontWeight: mono ? 700 : 600,
        fontFamily: mono ? "Mono" : "Jakarta",
      }}
    >
      {dot ? <div style={{ display: "flex", width: 9, height: 9, borderRadius: 9, background: dot, boxShadow: `0 0 12px ${dot}` }} /> : null}
      {children}
    </div>
  );
}

/** Bottom line: small print on the left, the URL on the right */
export function Footer({ left, url, bottom = 34 }: { left: ReactNode; url: string; bottom?: number }) {
  return (
    <div style={{ position: "absolute", left: 60, right: 60, bottom, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 16, color: MUTED }}>
      <div style={{ display: "flex", alignItems: "center" }}>{left}</div>
      <div style={{ display: "flex", color: INK, fontWeight: 800, fontSize: 20 }}>{url}</div>
    </div>
  );
}

/** Stock logo from the site's own /logos (absolute URL so the renderer can load it) */
export const logoUrl = (origin: string, path: string) => new URL(path, origin).toString();

/** The public origin for asset URLs: the configured site, else the request's own origin */
export function ogOrigin(req: Request) {
  const env = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const own = new URL(req.url).origin;
  return /localhost|127\.0\.0\.1/.test(own) || !env ? own : env;
}
