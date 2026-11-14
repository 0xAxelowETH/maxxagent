"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { planRebalance, type Target } from "@/lib/rebalance";

interface StockPrice {
  symbol: string;
  b20Address: string;
  navPrice: number;
}

/**
 * One-click rebalance of the wallet's tokenized stocks toward the agent's target basket.
 * Step 1 sells what is overweight, step 2 buys what is underweight with the USDC that came back.
 * Each step goes through the normal review screen, so nothing is sent without the user's confirmation.
 */
export function RebalancePanel({
  stocks,
  balances,
  usdcBalance,
  targets,
  targetLabel,
  pending,
  onSell,
  onBuy,
}: {
  stocks: StockPrice[];
  balances: Record<string, { rawTokens: number }>;
  usdcBalance: number | null;
  targets: Target[];
  targetLabel: string;
  pending: boolean;
  onSell: (legs: { symbol: string; b20Address: string; tokens: number }[], label: string) => void;
  onBuy: (legs: { symbol: string; b20Address: string; usd: number }[], label: string) => void;
}) {
  const [addUsd, setAddUsd] = useState<number>(0);
  // USDC balance right before step 1: after the sales, the increase is the proceeds that step 2 reinvests
  const [usdcBaseline, setUsdcBaseline] = useState<number | null>(null);
  const holdings = stocks
    .map((s) => ({ symbol: s.symbol, b20Address: s.b20Address, tokens: balances[s.symbol]?.rawTokens ?? 0, price: s.navPrice }))
    .filter((h) => h.tokens > 0);
  const usdc = usdcBalance ?? 0;
  const extra = Math.min(Math.max(0, addUsd), usdc);
  const proceeds = usdcBaseline !== null ? Math.max(0, usdc - usdcBaseline) : 0;
  const plan = useMemo(
    // proceeds count both as money to invest and as part of the portfolio the targets apply to
    () => planRebalance(holdings, targets, { usdcAvailable: extra + proceeds, addUsd: extra + proceeds }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(holdings), JSON.stringify(targets), extra, proceeds]
  );
  if (holdings.length === 0) return null; // nothing to rebalance yet: the buy panel above covers a first purchase

  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const nothingToDo = plan.sells.length === 0 && plan.buys.length === 0;
  // Selling while nothing can be bought back (every buy under the $0.50 minimum) would leave the user in USDC
  const tooSmall =
    plan.sells.length > 0 && plan.buys.length === 0 && plan.rows.some((r) => r.deltaUsd > 0 && /minimum|not enough/.test(r.note || ""));
  const weights = targets.filter((t) => t.weightBps > 0).map((t) => t.weightBps / 10000);
  const minWeight = weights.length ? Math.min(...weights) : 0;
  // the smallest target slice must reach $1: total portfolio needed, minus what is already there
  const addNeeded = minWeight > 0 ? Math.max(0, Math.ceil(1 / minWeight - plan.totalUsd)) : 0;
  return (
    <div className="rounded-2xl border border-cyan-500/35 bg-cyan-500/5 p-4 space-y-3" id="rebalance">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <ArrowDownUp className="h-4 w-4 text-cyan-300" /> Rebalance my portfolio to this basket
          </h3>
          <p className="text-[11px] text-slate-400">
            Your stocks today ({fmt(plan.totalUsd - extra - proceeds)}){proceeds > 0 ? ` + ${fmt(proceeds)} USDC from the sales` : ""} vs the {targetLabel} weights. Sell what is overweight, then buy what is
            underweight with the USDC it returns. Moves under 2% are skipped to save fees.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-slate-400">
          Add USDC
          <input
            type="number"
            min={0}
            step="1"
            value={addUsd || ""}
            placeholder="0"
            onChange={(e) => setAddUsd(Math.max(0, Number(e.target.value) || 0))}
            className="w-20 rounded-lg border border-slate-700 bg-[#040814] px-2 py-1 font-mono text-xs text-white outline-none focus:border-cyan-400"
            aria-label="Extra USDC to invest while rebalancing"
          />
          {usdcBalance !== null && <span className="text-slate-500">of {usdc.toFixed(2)}</span>}
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
              <th className="py-1.5">Stock</th>
              <th className="py-1.5 text-right">Now</th>
              <th className="py-1.5 text-right">Target</th>
              <th className="py-1.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {plan.rows.map((r) => (
              <tr key={r.symbol} className="border-b border-slate-800/60">
                <td className="py-1.5 font-sans font-semibold text-white">{r.symbol}</td>
                <td className="py-1.5 text-right text-slate-300">{fmt(r.currentUsd)}</td>
                <td className="py-1.5 text-right text-slate-300">{fmt(r.targetUsd)}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  {r.action === "sell" ? (
                    <span className="text-rose-300">Sell {fmt(-r.deltaUsd)}</span>
                  ) : r.action === "buy" ? (
                    <span className="text-emerald-300">Buy {fmt(r.amount)}</span>
                  ) : (
                    <span className="text-slate-500 font-sans">{r.note || "hold"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tooSmall && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-100">
          Too small for these weights: every stock needs at least $0.50, so selling now would leave you in USDC.
          {addNeeded > 0 ? ` Add about $${addNeeded} USDC above to rebalance fully.` : ""}
        </div>
      )}
      {nothingToDo ? (
        <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3 text-[11px] text-slate-400">
          Already balanced: every stock is within 2% of its target.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setUsdcBaseline(usdcBalance ?? 0);
              onSell(plan.sells, "rebalance");
            }}
            disabled={pending || plan.sells.length === 0 || tooSmall}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-40 cursor-pointer"
          >
            1. Sell overweight{plan.sells.length ? ` (≈ ${fmt(plan.sellUsd)})` : " — none"}
          </button>
          <button
            onClick={() => onBuy(plan.buys, "rebalance")}
            // Buy only once the sales are done (otherwise the USDC is not there yet)
            disabled={pending || plan.buys.length === 0 || plan.sells.length > 0}
            title={plan.sells.length > 0 ? "Do step 1 first: the buys use the USDC from the sales" : undefined}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40 cursor-pointer"
          >
            2. Buy underweight{plan.buys.length ? ` (${fmt(plan.buyUsd)})` : " — none"}
          </button>
        </div>
      )}
      {plan.scaledDown && (
        <p className="text-[11px] text-amber-200">Buys are scaled down to the USDC available. Add USDC to reach the full target.</p>
      )}
    </div>
  );
}
