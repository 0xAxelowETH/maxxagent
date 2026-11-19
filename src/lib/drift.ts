/**
 * How far a wallet's stock holdings are from a saved target basket.
 * Pure functions (no I/O, no imports), so they can be unit-tested.
 *
 * driftPct = the share of the stock portfolio that would have to move to match the target
 * (half the sum of the absolute weight differences). 0 = exactly on target, 100 = nothing in common.
 * USDC and ETH are not part of it: the target describes the stocks only.
 */
export interface DriftRow {
  symbol: string;
  currentPct: number;
  targetPct: number;
  /** current - target, in percentage points (positive = overweight) */
  diffPct: number;
}
export interface Drift {
  totalUsd: number;
  driftPct: number;
  rows: DriftRow[];
  /** most overweight first */
  over: DriftRow[];
  /** most underweight first */
  under: DriftRow[];
  /** stocks above the saved per-stock limit, largest first (empty without a limit) */
  breaches: DriftRow[];
}

/** Share points a stock may sit above its limit before it counts as a breach (price ticks, rounding) */
const BREACH_TOLERANCE_PCT = 0.5;

export function computeDrift(
  holdings: { symbol: string; usd: number }[],
  targets: { symbol: string; weightBps: number }[],
  maxWeightPct?: number
): Drift | null {
  const heldMap = new Map<string, number>();
  for (const h of holdings) {
    if (Number.isFinite(h.usd) && h.usd > 0) heldMap.set(h.symbol, (heldMap.get(h.symbol) ?? 0) + h.usd);
  }
  const targetMap = new Map<string, number>();
  for (const t of targets) {
    if (Number.isFinite(t.weightBps) && t.weightBps > 0) targetMap.set(t.symbol, (targetMap.get(t.symbol) ?? 0) + t.weightBps);
  }
  const totalUsd = [...heldMap.values()].reduce((a, b) => a + b, 0);
  const totalBps = [...targetMap.values()].reduce((a, b) => a + b, 0);
  if (!Number.isFinite(totalUsd) || !(totalUsd > 0) || !Number.isFinite(totalBps) || !(totalBps > 0)) return null;
  const symbols = [...new Set([...targetMap.keys(), ...heldMap.keys()])];
  const rows = symbols.map((symbol) => {
    const currentPct = ((heldMap.get(symbol) ?? 0) / totalUsd) * 100;
    const targetPct = ((targetMap.get(symbol) ?? 0) / totalBps) * 100;
    return { symbol, currentPct, targetPct, diffPct: currentPct - targetPct };
  });
  const driftPct = rows.reduce((a, r) => a + Math.abs(r.diffPct), 0) / 2;
  return {
    totalUsd,
    driftPct,
    rows,
    over: rows.filter((r) => r.diffPct > 0.05).sort((a, b) => b.diffPct - a.diffPct),
    under: rows.filter((r) => r.diffPct < -0.05).sort((a, b) => a.diffPct - b.diffPct),
    breaches: maxWeightPct ? rows.filter((r) => r.currentPct > maxWeightPct + BREACH_TOLERANCE_PCT).sort((a, b) => b.currentPct - a.currentPct) : [],
  };
}

/** A target saved by the user for one wallet (kept in that browser only) */
export interface SavedTarget {
  label: string;
  /** the request the basket was built from, if any */
  mandate?: string;
  weights: { symbol: string; weightBps: number }[];
  /** most any one stock may be, as a share of the stocks (from "max 30% per stock") */
  maxWeightPct?: number;
  /** drift (share of the stocks that would have to move) from which the agent warns; default 5 */
  alertPct?: number;
  /** ISO date */
  savedAt: string;
}

/** Validates what came out of storage: unknown stocks, bad weights or a wrong total mean "no target" */
export function parseSavedTarget(raw: unknown, knownSymbols: string[]): SavedTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.label !== "string" || !Array.isArray(r.weights)) return null;
  const weights: { symbol: string; weightBps: number }[] = [];
  for (const w of r.weights as unknown[]) {
    const x = w as Record<string, unknown>;
    if (!x || typeof x.symbol !== "string" || !knownSymbols.includes(x.symbol)) return null;
    const bps = Number(x.weightBps);
    if (!Number.isInteger(bps) || bps <= 0 || bps > 10000) return null;
    if (weights.some((y) => y.symbol === x.symbol)) return null;
    weights.push({ symbol: x.symbol, weightBps: bps });
  }
  if (weights.length === 0 || weights.length > 10 || weights.reduce((a, w) => a + w.weightBps, 0) !== 10000) return null;
  const cap = Number(r.maxWeightPct);
  const maxWeightPct = Number.isFinite(cap) && cap > 0 && cap < 100 ? Math.round(cap * 100) / 100 : undefined;
  // A limit the weights themselves break would flag the wallet forever: drop it
  if (maxWeightPct && weights.some((w) => w.weightBps / 100 > maxWeightPct + 0.5)) return null;
  const rawSavedAt = typeof r.savedAt === "string" ? r.savedAt.slice(0, 40) : "";
  const savedAt = rawSavedAt && !Number.isNaN(Date.parse(rawSavedAt)) ? rawSavedAt : new Date(0).toISOString();
  return {
    label: r.label.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 64) || "My target",
    mandate: typeof r.mandate === "string" ? r.mandate.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 300) : undefined,
    weights,
    maxWeightPct,
    alertPct: ALERT_PCT_CHOICES.includes(Number(r.alertPct)) ? Number(r.alertPct) : undefined,
    savedAt,
  };
}

/** Drift thresholds the user can pick for "warn me when my basket is this far off" */
export const ALERT_PCT_CHOICES = [2, 5, 10];
/** Default drift (share of the stock portfolio that would have to move) from which the agent warns */
export const DRIFT_ALERT_PCT = 5;
/** The threshold of a target: the one place both the page and the daily server check read it from */
export const alertPctOf = (t: { alertPct?: number } | null | undefined) => t?.alertPct ?? DRIFT_ALERT_PCT;

/** One finished rebalance step, kept in this browser per wallet */
export interface RebalanceLogEntry {
  at: string;
  side: "sell" | "buy";
  summary: string;
  txHashes: string[];
}

/** "NVDAc +6.2 pts" for the largest differences, overweight first (a broken limit comes first of all) */
export function driftSummary(drift: Drift, maxWeightPct?: number): string {
  if (drift.breaches.length && maxWeightPct)
    return drift.breaches
      .slice(0, 2)
      .map((r) => `${r.symbol} is ${r.currentPct.toFixed(1)}% of your stocks, above your ${maxWeightPct}% limit`)
      .join(" · ");
  const part = (label: string, rows: Drift["over"]) =>
    rows.length
      ? `${label}: ${rows
          .slice(0, 2)
          .map((r) => `${r.symbol} ${r.diffPct > 0 ? "+" : "−"}${Math.abs(r.diffPct).toFixed(1)} pts`)
          .join(", ")}`
      : "";
  return [part("Overweight", drift.over), part("Underweight", drift.under)].filter(Boolean).join(" · ");
}
