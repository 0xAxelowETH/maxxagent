"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { PreparedOrder } from "@/lib/basketExecutor";

// Fixed en-US format: the rest of the app uses toFixed (dot decimals), so the locale must not switch to "1,00"
const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Small USDC amounts need more decimals, or the guaranteed minimum looks identical to the estimate
const fmtUsdc = (n: number) => `${n.toFixed(n < 10 ? 4 : 2)} USDC`;
const fmtPct = (n: number) => `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(2)}%`;

/**
 * Order review shown BEFORE the wallet opens: what is paid, the estimate, the guaranteed minimum,
 * costs vs the Chainlink NAV, and how many wallet actions to expect. Quotes expire after `ttlMs`.
 */
export function OrderReview({
  order,
  label,
  ttlMs,
  busy,
  status,
  onConfirm,
  onCancel,
  onRefresh,
}: {
  order: PreparedOrder;
  label: string;
  ttlMs: number;
  busy: boolean;
  status: string;
  onConfirm: () => void;
  onCancel: () => void;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const isBuy = order.side === "buy";
  const secondsLeft = Math.max(0, Math.ceil((order.preparedAt + ttlMs - now) / 1000));
  const expired = secondsLeft === 0;
  const swaps = order.legs.length;
  const actions = order.approvals + swaps;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-review-title"
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-slate-700 bg-[#0b1120] p-5 space-y-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Review your order</div>
            <h2 id="order-review-title" className="text-lg font-extrabold text-white">
              {isBuy ? "Buy" : "Sell"} {label}
            </h2>
          </div>
          <button onClick={onCancel} disabled={busy} aria-label="Cancel" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Legs */}
        <div className="rounded-2xl border border-slate-800 divide-y divide-slate-800">
          {order.legs.map((q) => {
            const minOut = q.minAmountOutRaw ? Number(q.minAmountOutRaw) / (isBuy ? 1e8 : 1e6) : null;
            const navDev = typeof q.navDeviationPct === "number" ? q.navDeviationPct : null;
            return (
              <div key={q.symbol} className="p-3 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-white">{q.symbol}</span>
                  <span className="font-mono text-slate-300">
                    {isBuy ? fmtUsd(Number(q.amountInRaw) / 1e6) : `${(q.amountInTokens ?? 0).toFixed(6)} ${q.symbol}`}
                    <span className="text-slate-500"> → </span>
                    <span className="text-white font-semibold">
                      {isBuy ? `≈ ${(q.amountOutShares ?? 0).toFixed(6)} ${q.symbol}` : `≈ ${fmtUsdc(q.amountOutUsdc ?? 0)}`}
                    </span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                  {minOut !== null && (
                    <span>
                      Minimum: <span className="font-mono text-slate-200">{isBuy ? `${minOut.toFixed(6)} ${q.symbol}` : fmtUsdc(minOut)}</span>
                    </span>
                  )}
                  {typeof q.costPct === "number" && (
                    <span>
                      Cost: <span className="font-mono text-slate-200">{fmtPct(q.costPct)}</span>
                    </span>
                  )}
                  {navDev !== null && (
                    <span title="Effective price vs the Chainlink NAV. Negative means better than NAV.">
                      vs NAV:{" "}
                      <span className={`font-mono ${navDev > 1 ? "text-amber-300" : "text-slate-200"}`}>
                        {navDev > 0 ? "+" : ""}
                        {navDev.toFixed(2)}%
                      </span>
                    </span>
                  )}
                  {q.venues && q.venues.length > 0 && <span>Via {q.venues.slice(0, 2).join(", ")}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {order.skipped.length > 0 && (
          <div className="flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-100">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
            <div>
              <div className="font-semibold">Not included ({order.skipped.length}):</div>
              {order.skipped.map((s) => (
                <div key={s.symbol}>
                  {s.symbol}: {s.error}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Totals */}
        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
            <div className="font-sans text-[10px] text-slate-400">{isBuy ? "You pay" : "You sell (value)"}</div>
            <div className="text-base font-extrabold text-white">{fmtUsd(order.totalInUsd)}{isBuy ? " USDC" : ""}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
            <div className="font-sans text-[10px] text-slate-400">{isBuy ? "Est. value received" : "Est. USDC received"}</div>
            <div className="text-base font-extrabold text-emerald-300">
              {isBuy ? fmtUsd(order.totalOutUsd) : fmtUsdc(order.totalOutUsdc ?? 0)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
            <div className="font-sans text-[10px] text-slate-400">Total cost (impact + fees)</div>
            <div className="text-sm font-bold text-slate-200">{fmtPct(order.costPct)}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
            <div className="font-sans text-[10px] text-slate-400">Max slippage</div>
            <div className="text-sm font-bold text-slate-200">{(order.slippageBps / 100).toFixed(2)}%</div>
          </div>
        </div>

        <div className="flex gap-2 rounded-xl border border-slate-800 bg-[#070b14] p-3 text-[11px] text-slate-400">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-300" />
          <div>
            Your wallet will ask for <span className="text-slate-200">{actions} action{actions > 1 ? "s" : ""}</span>
            {order.approvals > 0 ? ` (${order.approvals} exact-amount approval${order.approvals > 1 ? "s" : ""} + ${swaps} swap${swaps > 1 ? "s" : ""})` : ` (${swaps} swap${swaps > 1 ? "s" : ""})`}, in one
            prompt if it supports batching. If the price moves more than the max slippage, the swap reverts and
            you keep your {isBuy ? "USDC" : "stock"}. MAXXAGENT never holds your funds.
          </div>
        </div>

        {busy && status && <div className="text-center text-[11px] text-slate-400">{status}</div>}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800 cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={expired ? onRefresh : onConfirm}
            disabled={busy}
            className={`flex-[2] inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-lg cursor-pointer disabled:opacity-60 ${
              expired
                ? "bg-slate-700 hover:bg-slate-600"
                : isBuy
                ? "bg-gradient-to-r from-[#4C6FFF] to-cyan-600 hover:brightness-110"
                : "bg-gradient-to-r from-rose-600 to-rose-500 hover:brightness-110"
            }`}
          >
            {busy ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" /> Refreshing…
              </>
            ) : expired ? (
              <>
                <RefreshCw className="h-4 w-4" /> Quote expired — refresh
              </>
            ) : (
              <>Confirm in wallet · {secondsLeft}s</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
