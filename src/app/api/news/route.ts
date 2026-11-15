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
  // Headlines and filings both make the list (headlines are far more frequent and would push filings out)
  const pick = (xs: typeof items, news: number, rooms: number, filings: number) => [
    ...xs.filter((x) => x.kind === "news").slice(0, news),
    ...xs.filter((x) => x.kind === "newsroom").slice(0, rooms),
    ...xs.filter((x) => x.kind === "filing").slice(0, filings),
  ].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  const list = symbol ? pick(items.filter((x) => x.symbol === symbol), 15, 8, 10) : pick(items, 50, 30, 30);
  return NextResponse.json(
    { ok: true, items: list, updatedAt: new Date().toISOString() },
    // Served from Vercel's CDN: fresh for 10 minutes, then the previous answer keeps being served instantly (up to a
    // day) while it refreshes in the background, so visitors almost never wait for a rebuild
    { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400" } }
  );
}
