/**
 * Recent earnings per stock, from the news feed: the latest SEC current report tagged "Earnings" (8-K item 2.02)
 * within the last `days`. Pure function, usable in the browser.
 */
export interface EarningsMark {
  publishedAt: string;
  changePct: number | null;
  url: string;
}

export function recentEarnings(
  items: { symbol: string; tags?: string[]; publishedAt: string; changePct: number | null; url: string }[],
  days = 7
): Record<string, EarningsMark> {
  const since = Date.now() - days * 86_400_000;
  const out: Record<string, EarningsMark> = {};
  for (const x of items) {
    if (!x.tags?.includes("Earnings")) continue;
    const t = Date.parse(x.publishedAt);
    if (!(t >= since)) continue;
    const prev = out[x.symbol];
    if (!prev || Date.parse(prev.publishedAt) < t) out[x.symbol] = { publishedAt: x.publishedAt, changePct: x.changePct, url: x.url };
  }
  return out;
}

export const earningsLabel = (m: EarningsMark) => {
  const d = new Date(m.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const ch = m.changePct === null ? "" : ` · ${m.changePct >= 0 ? "+" : ""}${m.changePct.toFixed(1)}% since`;
  return `Earnings ${d}${ch}`;
};
