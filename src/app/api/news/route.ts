import { NextRequest, NextResponse, after } from "next/server";
import { getNews, newsPending } from "@/lib/newsFeed";

/**
 * News & filings for the supported stocks: /api/news (all) or /api/news?symbol=NVDAc.
 * Headlines and filings link to their original source; each carries the price change since it was
 * published. For reference only, not financial advice.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  const items = await getNews();
  // Keep a rebuild that is still running alive after the response
  after(() => newsPending().then(() => undefined, () => undefined));
  if (!items) return NextResponse.json({ ok: false, loading: true, error: "News is loading." }, { status: 202 });
  const list = (symbol ? items.filter((x) => x.symbol === symbol) : items).slice(0, symbol ? 20 : 30);
  return NextResponse.json(
    { ok: true, items: list, updatedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
