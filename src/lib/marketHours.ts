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
