import { createPublicClient, parseAbi } from "viem";
import { base } from "viem/chains";
import { baseTransport } from "./rpc";

/**
 * Live risk for each supported stock from its own Chainlink NAV feed on Base: annualised volatility of
 * daily closes and the largest peak-to-trough fall, over roughly the last two months. Server only.
 * Replaces the fixed beta estimates in the agent's risk scoring whenever there is enough history.
 */
export interface RiskStats {
  /** annualised volatility of daily NAV returns, percent */
  volPct: number;
  /** largest fall from a previous high within the window, percent (negative) */
  maxDrawdownPct: number;
  /** trading days with a close in the window */
  days: number;
  /** first and last day used, YYYY-MM-DD */
  from: string;
  to: string;
}

const WINDOW_DAYS = 60;
const MIN_DAYS = 15;
const CACHE_MS = 12 * 3_600_000;

const FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const client = createPublicClient({ chain: base, transport: baseTransport({ timeout: 15000 }), batch: { multicall: true } });

/** Daily closes (last round of each UTC day) since `sinceSec`, oldest first */
async function dailyCloses(feed: `0x${string}`, sinceSec: number): Promise<[string, number][]> {
  const [latestId] = await client.readContract({ address: feed, abi: FEED_ABI, functionName: "latestRoundData" });
  const phaseBase = (latestId >> 64n) << 64n; // rounds before the current phase live in an older aggregator
  const byDay = new Map<string, { t: number; v: number }>();
  let next = latestId;
  for (let page = 0; page < 8 && next > phaseBase; page++) {
    const ids: bigint[] = [];
    for (let i = 0n; i < 300n && next - i > phaseBase; i++) ids.push(next - i);
    next -= BigInt(ids.length);
    const res = await client.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({ address: feed, abi: FEED_ABI, functionName: "getRoundData" as const, args: [id] })),
    });
    let oldest = Infinity;
    for (const r of res) {
      if (r.status !== "success") continue;
      const [, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
      const t = Number(updatedAt);
      if (!t || answer <= 0n) continue;
      oldest = Math.min(oldest, t);
      if (t < sinceSec) continue;
      // Weekday closes only: weekend heartbeat rounds repeat Friday's price and would understate volatility
      const dow = new Date(t * 1000).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const day = new Date(t * 1000).toISOString().slice(0, 10);
      const prev = byDay.get(day);
      if (!prev || t > prev.t) byDay.set(day, { t, v: Number(answer) });
    }
    if (oldest < sinceSec) break;
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, x]) => [d, x.v]);
}

function compute(closes: [string, number][]): RiskStats | null {
  if (closes.length < MIN_DAYS + 1) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i][1] / closes[i - 1][1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
  let peak = closes[0][1];
  let mdd = 0;
  for (const [, v] of closes) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return {
    volPct: sd * Math.sqrt(252) * 100,
    maxDrawdownPct: mdd * 100,
    days: closes.length,
    from: closes[0][0],
    to: closes[closes.length - 1][0],
  };
}

const cache = new Map<string, { at: number; value: RiskStats | null }>();
let inflight: Promise<void> | null = null;

async function refresh(stocks: { symbol: string; chainlinkFeed: `0x${string}` }[]) {
  const since = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86_400;
  // Two feeds at a time keeps the RPC load modest
  for (let i = 0; i < stocks.length; i += 2) {
    await Promise.all(
      stocks.slice(i, i + 2).map(async (s) => {
        try {
          cache.set(s.symbol, { at: Date.now(), value: compute(await dailyCloses(s.chainlinkFeed, since)) });
        } catch {
          // keep any older value; retried on the next request
        }
      })
    );
  }
}

/** The refresh still running, if any (the route keeps it alive after responding) */
export const riskStatsPending = () => inflight ?? Promise.resolve();

/**
 * Risk stats by symbol: the figures, or null when the feed has too little history. Waits at most `waitMs`;
 * symbols not computed yet are left out of this answer and keep loading for the next one.
 */
export async function getRiskStats(
  stocks: { symbol: string; chainlinkFeed: `0x${string}` }[],
  waitMs = 4000
): Promise<Record<string, RiskStats | null>> {
  const stale = stocks.filter((s) => {
    const c = cache.get(s.symbol);
    return !c || Date.now() - c.at > CACHE_MS;
  });
  if (stale.length && !inflight) inflight = refresh(stale).finally(() => (inflight = null));
  if (inflight) await Promise.race([inflight, new Promise((r) => setTimeout(r, waitMs))]);
  const out: Record<string, RiskStats | null> = {};
  for (const s of stocks) {
    const c = cache.get(s.symbol);
    if (c) out[s.symbol] = c.value;
  }
  return out;
}
