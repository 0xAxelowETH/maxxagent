import { cleanIndexName, parseBasketParam } from "@/lib/shareBasket";
import { basketCard } from "@/lib/og/basketCard";
import { ogOrigin } from "@/lib/og/kit";

/**
 * Share card for a basket link: /api/og?basket=NVDAc-40,MSFTc-60&name=…&ticker=…&creator=…&h=800
 * 1200x630 for X and link previews; h=800 gives the 3:2 card Farcaster mini app embeds use.
 * Rendered per link, so the 7-day figure gets a short budget (crawlers give up after a few seconds).
 * Onchain indexes use the pre-rendered /api/og/index/<id> instead.
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return basketCard({
    weights: parseBasketParam(q.get("basket")) ?? { NVDAc: 3400, MSFTc: 3300, GOOGLc: 3300 },
    name: cleanIndexName(q.get("name"), 48) || "Custom stock index",
    ticker: cleanIndexName(q.get("ticker"), 48) || undefined,
    creator: cleanIndexName(q.get("creator"), 24) || undefined,
    height: q.get("h") === "800" ? 800 : 630,
    origin: ogOrigin(req),
    timeoutMs: 2000,
  });
}
