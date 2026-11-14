/**
 * Matches onchain buys to published indexes. Pure function (no I/O, no imports), so it can be unit-tested.
 *
 * A swap carries no index id, so an "index buy" is recognised by its shape: one wallet buying exactly the
 * index's stocks within a short window, each in the index's proportion. Single-stock indexes are skipped
 * (they can't be told apart from a normal buy), and a basket where one stock failed does not count.
 */
export interface MatchTrade {
  wallet: string;
  /** unix seconds */
  time: number;
  side: "buy" | "sell";
  symbol: string;
  usd: number;
}
export interface MatchIndex {
  id: number;
  constituents: { symbol: string; weightBps: number }[];
}
export interface IndexBuyStats {
  id: number;
  buys: number;
  volumeUsd: number;
  wallets: number;
}

/** Legs of one basket are sent one after another: allow a few minutes for wallet confirmations */
const WINDOW_SEC = 300;
/** Each stock's share of the basket may differ from its weight by this many percentage points (rounding, price moves) */
const TOLERANCE_PCT = 2.5;

export function matchIndexBuys(trades: MatchTrade[], indexes: MatchIndex[]): IndexBuyStats[] {
  const candidates = indexes.filter((ix) => ix.constituents.length >= 2);
  const out = new Map<number, { buys: number; volumeUsd: number; wallets: Set<string> }>();

  const byWallet = new Map<string, MatchTrade[]>();
  for (const t of trades) {
    if (t.side !== "buy" || !(t.usd > 0)) continue;
    const list = byWallet.get(t.wallet) || [];
    list.push(t);
    byWallet.set(t.wallet, list);
  }

  for (const [wallet, list] of byWallet) {
    list.sort((a, b) => a.time - b.time);
    // Split into baskets: a new one starts after the window, or when a stock repeats
    const groups: MatchTrade[][] = [];
    let cur: MatchTrade[] = [];
    for (const t of list) {
      if (cur.length > 0 && (t.time - cur[0].time > WINDOW_SEC || cur.some((x) => x.symbol === t.symbol))) {
        groups.push(cur);
        cur = [];
      }
      cur.push(t);
    }
    if (cur.length > 0) groups.push(cur);

    for (const g of groups) {
      if (g.length < 2) continue;
      const total = g.reduce((a, t) => a + t.usd, 0);
      let best: { id: number; diff: number } | null = null;
      for (const ix of candidates) {
        if (ix.constituents.length !== g.length) continue;
        let diff = 0;
        let ok = true;
        for (const c of ix.constituents) {
          const leg = g.find((t) => t.symbol === c.symbol);
          if (!leg) {
            ok = false;
            break;
          }
          const d = Math.abs((leg.usd / total) * 100 - c.weightBps / 100);
          if (d > TOLERANCE_PCT) {
            ok = false;
            break;
          }
          diff += d;
        }
        // Closest weights win; on a tie the older index (lower id) keeps the credit
        if (ok && (!best || diff < best.diff - 1e-9 || (Math.abs(diff - best.diff) <= 1e-9 && ix.id < best.id))) best = { id: ix.id, diff };
      }
      if (!best) continue;
      const s = out.get(best.id) || { buys: 0, volumeUsd: 0, wallets: new Set<string>() };
      s.buys++;
      s.volumeUsd += total;
      s.wallets.add(wallet);
      out.set(best.id, s);
    }
  }
  return [...out.entries()]
    .map(([id, s]) => ({ id, buys: s.buys, volumeUsd: Math.round(s.volumeUsd * 100) / 100, wallets: s.wallets.size }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd || a.id - b.id);
}
