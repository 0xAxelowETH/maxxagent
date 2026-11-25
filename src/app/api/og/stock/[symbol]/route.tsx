import { notFound } from "next/navigation";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { findStock, stockCard } from "@/lib/og/stockCard";

/**
 * Pre-rendered share card for each stock page: /api/og/stock/NVDAc
 * Built at deploy and refreshed in the background every 30 minutes (ISR), so link-preview crawlers,
 * which give up after a few seconds, always get the image instantly instead of waiting for a render.
 */
export const runtime = "nodejs";
export const revalidate = 1800;
export const dynamicParams = false;

export function generateStaticParams() {
  return BASE_TOKENIZED_STOCKS.map((s) => ({ symbol: s.symbol }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (!findStock(symbol)) notFound();
  // Rendered in the background (build or ISR refresh): nobody waits, so give live data time to load
  return stockCard(symbol, 20000);
}
