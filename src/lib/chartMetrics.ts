export type SeriesPoint = [number, number];

export interface SeriesSummary {
  high: number;
  low: number;
  first: number;
  last: number;
  returnPct: number;
}

/** Converts a price series to percentage change relative to its earliest point. */
export function toPctSeries(pts: SeriesPoint[]): SeriesPoint[] {
  if (pts.length < 2) return [];
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  const base = sorted[0][1];
  if (!(base > 0)) return [];
  return sorted.map(([t, v]) => [t, ((v - base) / base) * 100]);
}

/** Computes period High, Low, and % Return across a chronological price series. */
export function summarizeSeries(pts: SeriesPoint[]): SeriesSummary | null {
  if (pts.length < 2) return null;
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  let high = -Infinity;
  let low = Infinity;
  for (const [, v] of sorted) {
    if (v > high) high = v;
    if (v < low) low = v;
  }
  const first = sorted[0][1];
  const last = sorted[sorted.length - 1][1];
  if (!Number.isFinite(high) || !Number.isFinite(low) || !(first > 0)) return null;
  return { high, low, first, last, returnPct: ((last - first) / first) * 100 };
}
