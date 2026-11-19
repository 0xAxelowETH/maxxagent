import { BASE_TOKENIZED_STOCKS, MIN_BUY_USD } from "./tokenizedStocks";

// Shareable basket links: /?basket=NVDAc-40,MSFTc-30&amount=50&name=My%20index
const SHARE_SYMBOLS = new Set(BASE_TOKENIZED_STOCKS.map((s) => s.symbol));

/** weights in bps (10,000 = 100%) -> query string */
export function basketToQuery(weightsBps: Record<string, number>, amountUsd?: number): string {
  const parts = Object.entries(weightsBps)
    .filter(([, w]) => w > 0)
    .map(([sym, w]) => `${sym}-${Number((w / 100).toFixed(2))}`);
  const q = new URLSearchParams({ basket: parts.join(",") });
  if (amountUsd && amountUsd >= MIN_BUY_USD) q.set("amount", String(amountUsd));
  return q.toString();
}

/** "NVDAc-40,MSFTc-30" -> weights in bps summing to exactly 10,000. Unknown symbols are dropped. */
export function parseBasketParam(raw: string | null | undefined): Record<string, number> | null {
  if (!raw) return null;
  const pct = new Map<string, number>();
  for (const part of raw.slice(0, 500).split(",", 20)) {
    if (pct.size >= 10) break;
    const [sym, val] = part.split("-");
    const n = Number(val);
    if (SHARE_SYMBOLS.has(sym) && Number.isFinite(n) && n > 0 && n <= 100 && !pct.has(sym)) pct.set(sym, n);
  }
  if (pct.size === 0) return null;
  const total = [...pct.values()].reduce((a, b) => a + b, 0);
  const weightsBps: Record<string, number> = {};
  for (const [sym, n] of pct) weightsBps[sym] = Math.max(1, Math.round((n / total) * 10000));
  // rounding remainder goes to the largest weight so the basket is exactly 100%
  const diff = 10000 - Object.values(weightsBps).reduce((a, b) => a + b, 0);
  const largest = Object.entries(weightsBps).sort((a, b) => b[1] - a[1])[0][0];
  weightsBps[largest] += diff;
  return weightsBps;
}

/** Parses and validates a shared basket link's query string. */
export function parseSharedBasket(search: string): { weightsBps: Record<string, number>; amountUsd?: number } | null {
  const q = new URLSearchParams(search);
  const weightsBps = parseBasketParam(q.get("basket"));
  if (!weightsBps) return null;
  const amount = Number(q.get("amount"));
  return { weightsBps, amountUsd: Number.isFinite(amount) && amount >= MIN_BUY_USD && amount <= 100_000 ? Math.round(amount * 100) / 100 : undefined };
}

/** A user-given index name, safe to show: no control or direction-override characters, at most `max` chars */
export function cleanIndexName(raw: string | null | undefined, max = 64): string {
  const cleaned = (raw || "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  return Array.from(cleaned).slice(0, max).join("").trim();
}

/** Path of the share card image for a basket (see /api/og) */
export function basketImagePath(
  weightsBps: Record<string, number>,
  opts: { name?: string; ticker?: string; creator?: string; tall?: boolean } = {}
): string {
  const q = new URLSearchParams({
    basket: Object.entries(weightsBps)
      .filter(([, w]) => w > 0)
      .map(([s, w]) => `${s}-${Number((w / 100).toFixed(2))}`)
      .join(","),
  });
  if (opts.name) q.set("name", opts.name);
  if (opts.ticker) q.set("ticker", opts.ticker);
  if (opts.creator) q.set("creator", opts.creator);
  if (opts.tall) q.set("h", "800");
  return `/api/og?${q.toString()}`;
}
