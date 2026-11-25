import { NextRequest, NextResponse } from "next/server";
import { GET as getStocks } from "@/app/api/stocks/route";
import type { LiveTokenizedStock } from "@/lib/tokenizedStocks";

/**
 * The 10 tokenized stocks MAXXAGENT supports, with live prices, for other agents (MAXXAGENT Baskets skill).
 *   GET /api/skill/stocks
 * Read-only. NAV is the Chainlink price; dexPrice is the 24/7 price on Base. Not financial advice.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, "");
const round = (v: unknown, d = 2) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(d)) : null);

export async function GET(request: NextRequest) {
  const res = await getStocks(new NextRequest(new URL("/api/stocks", request.url))).catch(() => null);
  const j = res?.ok ? await res.json().catch(() => null) : null;
  if (!Array.isArray(j?.stocks)) return NextResponse.json({ ok: false, error: "Live prices are unavailable right now. Please retry." }, { status: 503 });
  const stocks = (j.stocks as LiveTokenizedStock[]).map((s) => ({
    symbol: s.symbol,
    company: s.companyName,
    sector: s.sector,
    navPriceUsd: round(s.navPrice),
    dexPriceUsd: round(s.dexPrice24_7),
    change24hPct: round(s.change24hPct),
    dexLiquidityUsd: round(s.dexLiquidityUsd, 0),
    token: s.b20Address,
    page: `${SITE}/stock/${s.symbol}`,
  }));
  return NextResponse.json(
    {
      ok: true,
      chain: "Base (8453)",
      stocks,
      notice: "Prices only, not financial advice. Coinbase tokenized stocks on Base are only for eligible persons outside the U.S.",
      fetchedAt: j.fetchedAt,
    },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } }
  );
}
