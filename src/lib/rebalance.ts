/**
 * Rebalance planner: moves a wallet's B20 stock holdings toward target weights.
 * Pure function (no I/O), so it can be unit-tested. Selling happens first, then buying with the USDC
 * that the sales return plus the USDC already in the wallet.
 */

export interface Holding {
  symbol: string;
  b20Address: string;
  /** stock tokens held */
  tokens: number;
  /** price per token (Chainlink NAV) */
  price: number;
}

export interface Target {
  symbol: string;
  b20Address: string;
  weightBps: number;
}

export interface RebalanceRow {
  symbol: string;
  b20Address: string;
  currentUsd: number;
  targetUsd: number;
  deltaUsd: number;
  action: "sell" | "buy" | "hold";
  /** sells: tokens to sell. buys: USDC to spend */
  amount: number;
  note?: string;
}

export interface RebalancePlan {
  totalUsd: number;
  rows: RebalanceRow[];
  sells: { symbol: string; b20Address: string; tokens: number }[];
  buys: { symbol: string; b20Address: string; usd: number }[];
  sellUsd: number;
  buyUsd: number;
  /** buys were scaled down to fit the USDC available */
  scaledDown: boolean;
}

export function planRebalance(
  holdings: Holding[],
  targets: Target[],
  opts: {
    usdcAvailable?: number;
    addUsd?: number;
    minBuyUsd?: number;
    minSellUsd?: number;
    bandPct?: number;
    swapCostPct?: number;
    /** per-stock limit (share of the stocks): a stock above it is trimmed even inside the tolerance band */
    maxWeightPct?: number;
  } = {}
): RebalancePlan {
  const rawUsdcAvail = Number.isFinite(opts.usdcAvailable) ? Math.max(0, opts.usdcAvailable!) : 0;
  const rawAddUsd = Number.isFinite(opts.addUsd) ? Math.max(0, opts.addUsd!) : 0;
  const { minBuyUsd = 0.5 /* = MIN_BUY_USD in tokenizedStocks.ts (kept literal: this file has no imports) */, minSellUsd = 0.25, bandPct = 2, swapCostPct = 0.6 } = opts;
  const MAX_LEG_USD = 2500;
  const bySymbol = new Map<string, { symbol: string; b20Address: string; tokens: number; price: number; weightBps: number }>();
  for (const h of holdings) {
    if (h.tokens > 0 && h.price > 0) {
      const prev = bySymbol.get(h.symbol);
      if (prev) prev.tokens += h.tokens;
      else bySymbol.set(h.symbol, { ...h, weightBps: 0 });
    }
  }
  const totalTargetBps = targets.reduce((a, t) => a + (Number.isFinite(t.weightBps) ? Math.max(0, t.weightBps) : 0), 0) || 1;
  for (const t of targets) {
    const cur = bySymbol.get(t.symbol);
    const w = ((Number.isFinite(t.weightBps) ? Math.max(0, t.weightBps) : 0) / totalTargetBps) * 10000;
    if (cur) cur.weightBps += w;
    else bySymbol.set(t.symbol, { symbol: t.symbol, b20Address: t.b20Address, tokens: 0, price: 0, weightBps: w });
  }

  const holdingsUsd = [...bySymbol.values()].reduce((a, x) => a + x.tokens * x.price, 0);
  const totalUsd = holdingsUsd + rawAddUsd;
  const band = (totalUsd * bandPct) / 100;

  const rows: RebalanceRow[] = [...bySymbol.values()].map((x) => {
    const currentUsd = x.tokens * x.price;
    const targetUsd = (totalUsd * x.weightBps) / 10000;
    const deltaUsd = targetUsd - currentUsd;
    let action: RebalanceRow["action"] = "hold";
    let amount = 0;
    let note: string | undefined;
    const overLimit = opts.maxWeightPct !== undefined && totalUsd > 0 && (currentUsd / totalUsd) * 100 > opts.maxWeightPct + 0.5;
    if (Math.abs(deltaUsd) <= band && !(overLimit && deltaUsd < 0)) note = "within tolerance";
    else if (deltaUsd < 0) {
      const cappedSellUsd = Math.min(-deltaUsd, MAX_LEG_USD);
      if (cappedSellUsd < minSellUsd) note = `below $${minSellUsd} minimum`;
      else {
        action = "sell";
        // Selling everything or down to unsellable dust (< minSellUsd): sell the exact holding (unless capped by $2,500 router limit)
        const fullExit = (x.weightBps === 0 || targetUsd < minSellUsd) && currentUsd <= MAX_LEG_USD;
        amount = fullExit ? x.tokens : cappedSellUsd / x.price;
        if (-deltaUsd > MAX_LEG_USD) note = `capped at $${MAX_LEG_USD} max per swap`;
      }
    } else if (deltaUsd < minBuyUsd) note = `below $${minBuyUsd.toFixed(2)} minimum`;
    else {
      action = "buy";
      amount = Math.min(MAX_LEG_USD, Math.floor(deltaUsd * 100) / 100);
      if (deltaUsd > MAX_LEG_USD) note = `capped at $${MAX_LEG_USD} max per swap`;
    }
    return { symbol: x.symbol, b20Address: x.b20Address, currentUsd, targetUsd, deltaUsd, action, amount, note };
  });

  const sellRows = rows.filter((r) => r.action === "sell");
  const sellUsd = sellRows.reduce((a, r) => a + (r.amount * (bySymbol.get(r.symbol)!.price || 0)), 0);
  // USDC for buys: wallet USDC (incl. the extra amount the user adds) + sale proceeds after swap costs
  const budget = rawUsdcAvail + sellUsd * (1 - swapCostPct / 100);
  let buyRows = rows.filter((r) => r.action === "buy");
  const wanted = buyRows.reduce((a, r) => a + r.amount, 0);
  let scaledDown = false;
  if (wanted > budget && wanted > 0) {
    scaledDown = true;
    // Iteratively drop legs that scale below minBuyUsd so remaining active buy legs get full budget
    let active = [...buyRows];
    while (active.length > 0) {
      const activeWanted = active.reduce((a, r) => a + Math.min(MAX_LEG_USD, Math.floor(r.deltaUsd * 100) / 100), 0) || 1;
      const k = Math.max(0, budget) / activeWanted;
      const dropped: RebalanceRow[] = [];
      const kept: RebalanceRow[] = [];
      for (const r of active) {
        const scaled = Math.min(MAX_LEG_USD, Math.floor(Math.min(MAX_LEG_USD, r.deltaUsd) * k * 100) / 100);
        if (scaled < minBuyUsd) {
          r.action = "hold";
          r.note = "not enough USDC";
          r.amount = 0;
          dropped.push(r);
        } else {
          r.amount = scaled;
          kept.push(r);
        }
      }
      if (dropped.length === 0) break;
      active = kept;
    }
    buyRows = rows.filter((r) => r.action === "buy");
  }

  return {
    totalUsd,
    rows: rows.sort((a, b) => b.targetUsd + b.currentUsd - (a.targetUsd + a.currentUsd)),
    sells: sellRows.map((r) => ({ symbol: r.symbol, b20Address: r.b20Address, tokens: r.amount })),
    buys: buyRows.map((r) => ({ symbol: r.symbol, b20Address: r.b20Address, usd: r.amount })),
    sellUsd,
    buyUsd: buyRows.reduce((a, r) => a + r.amount, 0),
    scaledDown,
  };
}
