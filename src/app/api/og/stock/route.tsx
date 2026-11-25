import { stockCard } from "@/lib/og/stockCard";

/**
 * Old address of the stock share card, kept for links already shared: /api/og/stock?symbol=NVDAc
 * Pages now point to the pre-rendered /api/og/stock/NVDAc, which crawlers get instantly.
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  return stockCard(new URL(req.url).searchParams.get("symbol") || "", 2000);
}
