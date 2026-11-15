import { NextRequest, NextResponse } from "next/server";
import { navDailyCloses } from "@/lib/riskStats";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";

/**
 * Hypothetical replay of a basket over the last ~30 days: /api/replay?basket=NVDAc-25,GOOGLc-20 (weights are % of
 * the money; whatever is left is cash that stays flat). Uses each stock's daily Chainlink NAV closes from the
 * shared cache (refreshed every 6 h), only days every stock has. No swap costs, no timing: an illustration of how the
 * mix moved, not a return anyone earned and not a prediction.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("basket") || "").slice(0, 300);
  const legs: { symbol: string; w: number; feed: `0x${string}` }[] = [];
  for (const part of raw.split(",")) {
    const [sym, pct] = part.split("-");
    const meta = BASE_TOKENIZED_STOCKS.find((s) => s.symbol === sym);
    const w = Number(pct);
    if (!meta || !(w > 0 && w <= 100) || legs.some((l) => l.symbol === sym)) {
      return NextResponse.json({ ok: false, error: "Invalid basket." }, { status: 400 });
    }
    legs.push({ symbol: sym, w: w / 100, feed: meta.chainlinkFeed });
  }
  const invested = legs.reduce((a, l) => a + l.w, 0);
  if (!legs.length || legs.length > 10 || invested > 1.0001) return NextResponse.json({ ok: false, error: "Invalid basket." }, { status: 400 });

  try {
    const series = await Promise.all(legs.map((l) => navDailyCloses(l.feed)));
    // Days present for every stock, by New York close timestamp
    const common = series.map((s) => new Map(s.map(([t, v]) => [t, v])));
    const days = [...common[0].keys()].filter((t) => common.every((m) => m.has(t))).sort((a, b) => a - b).slice(-22);
    if (days.length < 5) return NextResponse.json({ ok: false, error: "Not enough price history yet." }, { status: 200 });
    const first = days[0];
    const cash = Math.max(0, 1 - invested);
    const points = days.map((t) => {
      const v = cash + legs.reduce((a, l, i) => a + l.w * (common[i].get(t)! / common[i].get(first)!), 0);
      return [t, Number((v * 100).toFixed(3))] as [number, number];
    });
    const last = days[days.length - 1];
    return NextResponse.json(
      {
        ok: true,
        from: first,
        to: last,
        points,
        basketPct: points[points.length - 1][1] - 100,
        stocks: legs.map((l, i) => ({ symbol: l.symbol, pct: (common[i].get(last)! / common[i].get(first)! - 1) * 100 })),
        cashPct: cash * 100,
      },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=21600" } }
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Price history is unavailable right now." }, { status: 502 });
  }
}
