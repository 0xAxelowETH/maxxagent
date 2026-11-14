"use client";

import { useState } from "react";
import { Target as TargetIcon, Trash2 } from "lucide-react";
import { RebalancePanel } from "@/components/RebalancePanel";
import type { Drift, SavedTarget } from "@/lib/drift";

/** Drift (share of the stock portfolio that would have to move) from which a rebalance is suggested */
export const DRIFT_ALERT_PCT = 5;

interface StockPrice {
  symbol: string;
  b20Address: string;
  navPrice: number;
}

const pct = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}%`;

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

/**
 * The saved target of the connected wallet, checked against what the wallet holds right now.
 * Nothing here trades on its own: it only reports the drift and opens the normal rebalance plan,
 * where every step still goes through the review screen and the user's signature.
 */
export function TargetWatch({
  target,
  drift,
  stocks,
  balances,
  usdcBalance,
  pending,
  onSell,
  onBuy,
  onRemove,
}: {
  target: SavedTarget;
  /** null when the wallet holds no stocks yet */
  drift: Drift | null;
  stocks: StockPrice[];
  balances: Record<string, { rawTokens: number }>;
  usdcBalance: number | null;
  pending: boolean;
  onSell: (legs: { symbol: string; b20Address: string; tokens: number }[], label: string) => void;
  onBuy: (legs: { symbol: string; b20Address: string; usd: number }[], label: string) => void;
  onRemove: () => void;
}) {
  const breached = (drift?.breaches.length ?? 0) > 0;
  const off = drift !== null && (drift.driftPct >= DRIFT_ALERT_PCT || breached);
  const [open, setOpen] = useState(false);
  const saved = new Date(target.savedAt);
  const targets = target.weights.flatMap((w) => {
    const s = stocks.find((x) => x.symbol === w.symbol);
    return s ? [{ symbol: w.symbol, b20Address: s.b20Address, weightBps: w.weightBps }] : [];
  });

  return (
    <section
      aria-label="Your saved target"
      data-testid="target-watch"
      className={`rounded-2xl border p-4 space-y-3 ${off ? "border-amber-500/40 bg-amber-500/5" : "border-slate-800 bg-[#070b14]"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <TargetIcon className={`h-4 w-4 ${off ? "text-amber-300" : "text-emerald-300"}`} />
            Your target: {target.label}
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {target.weights.map((w) => `${w.symbol} ${(w.weightBps / 100).toFixed(0)}%`).join(" · ")}
            {target.maxWeightPct ? ` · limit ${target.maxWeightPct}% per stock` : ""}
            {saved.getTime() > 0 ? ` · saved ${saved.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
          </p>
          {target.mandate && <p className="mt-0.5 text-[11px] italic text-slate-500 line-clamp-1">&ldquo;{target.mandate}&rdquo;</p>}
        </div>
        <button
          onClick={onRemove}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-rose-400 hover:text-rose-200 cursor-pointer"
          title="Forget this target (it is only stored in this browser)"
        >
          <Trash2 className="h-3 w-3" />
          Remove
        </button>
      </div>

      {drift === null ? (
        <p className="text-xs text-slate-300">You don&apos;t hold any of these stocks yet. Buy the basket from the Agent tab to start tracking it.</p>
      ) : off ? (
        <div className="space-y-2">
          {breached ? (
            <p className="text-xs text-amber-100" data-testid="limit-breach">
              <strong>Limit broken:</strong> {driftSummary(drift, target.maxWeightPct)}. The plan trims it back to the target.
            </p>
          ) : (
            <p className="text-xs text-amber-100">
              <strong className="font-mono text-sm">{pct(drift.driftPct)}</strong> of your stocks are out of line with this target.{" "}
              <span className="text-amber-200/80">{driftSummary(drift)}</span>
            </p>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 cursor-pointer"
          >
            {open ? "Hide the rebalance plan" : "Show the rebalance plan"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-emerald-200">
          On target: only <strong className="font-mono">{pct(drift.driftPct)}</strong> of your stocks would have to move. Nothing to do.
        </p>
      )}

      {open && off && (
        <RebalancePanel
          stocks={stocks}
          balances={balances}
          usdcBalance={usdcBalance}
          targets={targets}
          targetLabel={target.label}
          pending={pending}
          onSell={onSell}
          onBuy={onBuy}
          maxWeightPct={target.maxWeightPct}
        />
      )}
      <p className="text-[10px] text-slate-500">
        Checked each time you open MAXXAGENT with this wallet. Stored in this browser only. Nothing is traded without your signature.
      </p>
    </section>
  );
}
