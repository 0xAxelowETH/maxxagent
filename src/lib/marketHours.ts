/**
 * US stock market (NYSE/Nasdaq) regular session: 9:30-16:00 New York time, Mon-Fri, minus exchange holidays.
 * Outside it the Chainlink NAV stops tracking live trades while DEX prices keep moving 24/7.
 */

// NYSE full-day holidays and 13:00 early closes (New York dates)
const HOLIDAYS = new Set([
  "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

export const isUsHoliday = (date: string) => HOLIDAYS.has(date);

export type MarketState = "open" | "pre" | "after" | "closed" | "weekend" | "holiday";

function nyParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday as string, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function usMarketStatus(now = new Date()): { state: MarketState; label: string; detail: string } {
  const { date, weekday, minutes } = nyParts(now);
  const open = 9 * 60 + 30;
  const close = EARLY_CLOSE.has(date) ? 13 * 60 : 16 * 60;
  const drift = "DEX prices can drift from NAV until the next open.";
  if (weekday === "Sat" || weekday === "Sun") return { state: "weekend", label: "US market closed (weekend)", detail: drift };
  if (HOLIDAYS.has(date)) return { state: "holiday", label: "US market closed (holiday)", detail: drift };
  if (minutes >= open && minutes < close) {
    const left = close - minutes;
    return {
      state: "open",
      label: "US market open",
      detail: `Closes in ${Math.floor(left / 60)}h ${left % 60}m${EARLY_CLOSE.has(date) ? " (early close)" : ""}. NAV tracks live trading.`,
    };
  }
  if (minutes >= 4 * 60 && minutes < open) return { state: "pre", label: "US pre-market", detail: `Regular session opens at 9:30 New York time. ${drift}` };
  if (minutes >= close && minutes < 20 * 60) return { state: "after", label: "US after-hours", detail: drift };
  return { state: "closed", label: "US market closed", detail: drift };
}

/** New York calendar date (YYYY-MM-DD) and weekday of a moment: the trading day it belongs to */
export function nyDay(d: Date): { date: string; weekday: string } {
  const { date, weekday } = nyParts(d);
  return { date, weekday };
}

/** Unix seconds of the New York close on a New York date (13:00 ET on early close, else 16:00 ET). */
export function nyCloseUnix(date: string): number {
  const closeMinutes = EARLY_CLOSE.has(date) ? 13 * 60 : 16 * 60;
  for (const h of [17, 18, 20, 21]) {
    const t = Date.parse(`${date}T${h}:00:00Z`);
    if (nyParts(new Date(t)).minutes === closeMinutes) return t / 1000;
  }
  return Date.parse(`${date}T${EARLY_CLOSE.has(date) ? 18 : 21}:00:00Z`) / 1000;
}

/** Unix seconds of the 9:30 New York open on a New York date (13:30 or 14:30 UTC, following daylight saving) */
export function nyOpenUnix(date: string): number {
  for (const h of [13, 14]) {
    const t = Date.parse(`${date}T${h}:30:00Z`);
    if (nyParts(new Date(t)).minutes === 9 * 60 + 30) return t / 1000;
  }
  return Date.parse(`${date}T14:30:00Z`) / 1000;
}

/** The next regular-session open after `now` (skips weekends and exchange holidays), as unix seconds */
export function nextOpenUnix(now = new Date()): number | null {
  for (let d = 0; d <= 10; d++) {
    const { date, weekday } = nyParts(new Date(now.getTime() + d * 86_400_000));
    if (weekday === "Sat" || weekday === "Sun" || HOLIDAYS.has(date)) continue;
    const t = nyOpenUnix(date);
    if (t * 1000 > now.getTime()) return t;
  }
  return null;
}

export interface NavChartGap {
  from: [number, number];
  to: [number, number];
}

/**
 * Splits a Chainlink NAV time series across multi-hour market closures (weekends and exchange holidays,
 * default gap >= 20h) so 7D/30D charts can shade closure bands instead of drawing solid flat diagonals.
 */
export function splitNavWeekendGaps(
  pts: [number, number][],
  gapSec = 20 * 3600
): { segments: [number, number][][]; gaps: NavChartGap[] } {
  if (pts.length === 0) return { segments: [], gaps: [] };
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  const segments: [number, number][][] = [[sorted[0]]];
  const gaps: NavChartGap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr[0] - prev[0] >= gapSec) {
      gaps.push({ from: prev, to: curr });
      segments.push([curr]);
    } else {
      segments[segments.length - 1].push(curr);
    }
  }
  return { segments, gaps };
}
