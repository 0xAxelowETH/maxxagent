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
  opts: { usdcAvailable?: number; addUsd?: number; minBuyUsd?: number; minSellUsd?: number; bandPct?: number; swapCostPct?: number } = {}
): RebalancePlan {
  const { usdcAvailable = 0, addUsd = 0, minBuyUsd = 1, minSellUsd = 0.25, bandPct = 2, swapCostPct = 0.6 } = opts;
  const bySymbol = new Map<string, { symbol: string; b20Address: string; tokens: number; price: number; weightBps: number }>();
  for (const h of holdings) if (h.tokens > 0 && h.price > 0) bySymbol.set(h.symbol, { ...h, weightBps: 0 });
  const totalTargetBps = targets.reduce((a, t) => a + Math.max(0, t.weightBps), 0) || 1;
  for (const t of targets) {
    const cur = bySymbol.get(t.symbol);
    const w = (Math.max(0, t.weightBps) / totalTargetBps) * 10000;
    if (cur) cur.weightBps = w;
    else bySymbol.set(t.symbol, { symbol: t.symbol, b20Address: t.b20Address, tokens: 0, price: 0, weightBps: w });
  }

  const holdingsUsd = [...bySymbol.values()].reduce((a, x) => a + x.tokens * x.price, 0);
  const totalUsd = holdingsUsd + Math.max(0, addUsd);
  const band = (totalUsd * bandPct) / 100;

  const rows: RebalanceRow[] = [...bySymbol.values()].map((x) => {
    const currentUsd = x.tokens * x.price;
    const targetUsd = (totalUsd * x.weightBps) / 10000;
    const deltaUsd = targetUsd - currentUsd;
    let action: RebalanceRow["action"] = "hold";
    let amount = 0;
    let note: string | undefined;
    if (Math.abs(deltaUsd) <= band) note = "within tolerance";
    else if (deltaUsd < 0) {
      const sellUsd = -deltaUsd;
      if (sellUsd < minSellUsd) note = `below $${minSellUsd} minimum`;
      else {
        action = "sell";
        // Selling (almost) everything: sell the exact holding so no dust is left
        amount = targetUsd <= band || sellUsd >= currentUsd * 0.99 ? x.tokens : sellUsd / x.price;
      }
    } else if (deltaUsd < minBuyUsd) note = `below $${minBuyUsd} minimum`;
    else {
      action = "buy";
      amount = Math.floor(deltaUsd * 100) / 100;
    }
    return { symbol: x.symbol, b20Address: x.b20Address, currentUsd, targetUsd, deltaUsd, action, amount, note };
  });

  const sellRows = rows.filter((r) => r.action === "sell");
  const sellUsd = sellRows.reduce((a, r) => a + (r.amount * (bySymbol.get(r.symbol)!.price || 0)), 0);
  // USDC for buys: wallet USDC (incl. the extra amount the user adds) + sale proceeds after swap costs
  const budget = usdcAvailable + sellUsd * (1 - swapCostPct / 100);
  let buyRows = rows.filter((r) => r.action === "buy");
  const wanted = buyRows.reduce((a, r) => a + r.amount, 0);
  let scaledDown = false;
  if (wanted > budget && wanted > 0) {
    scaledDown = true;
    const k = Math.max(0, budget) / wanted;
    for (const r of buyRows) {
      r.amount = Math.floor(r.amount * k * 100) / 100;
      if (r.amount < minBuyUsd) {
        r.action = "hold";
        r.note = "not enough USDC";
        r.amount = 0;
      }
    }
    buyRows = buyRows.filter((r) => r.action === "buy");
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
