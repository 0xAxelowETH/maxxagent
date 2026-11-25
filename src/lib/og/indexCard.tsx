import { HIDDEN, indexCount, readIndex } from "@/lib/indexRegistry";
import { basketCard } from "@/lib/og/basketCard";
import { OG_SITE, withTimeout } from "@/lib/og/kit";

/**
 * Pre-rendered share card for an onchain index page (/index/<id>), built from the registry: its name,
 * ticker, creator and weights. Used by /api/og/index/<id> (1200x630) and /api/og/index/<id>/tall (3:2).
 * Rendered in the background (build or ISR refresh), so the 7-day figure gets a generous budget.
 */
export const parseIndexId = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : -1);

/** Ids built at deploy: every visible index (more are rendered on first request, then cached) */
export async function indexStaticParams(): Promise<{ id: string }[]> {
  const total = (await withTimeout(indexCount(), 10000)) ?? 0;
  return Array.from({ length: Math.min(total, 100) }, (_, i) => i)
    .filter((i) => !HIDDEN.has(i))
    .map((i) => ({ id: String(i) }));
}

export async function indexCard(idParam: string, height: 630 | 800) {
  const id = parseIndexId(idParam);
  const ix = id >= 0 ? await withTimeout(readIndex(id), 10000) : null;
  if (!ix) return null;
  return basketCard({
    weights: Object.fromEntries(ix.constituents.map((c) => [c.symbol, c.weightBps])),
    name: ix.name,
    ticker: `${ix.ticker} · onchain index #${ix.id}`,
    creator: `${ix.creator.slice(0, 6)}…${ix.creator.slice(-4)}`,
    height,
    origin: OG_SITE,
    timeoutMs: 20000,
  });
}
