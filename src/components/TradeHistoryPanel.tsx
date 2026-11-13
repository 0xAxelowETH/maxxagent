"use client";

import { History, ExternalLink } from "lucide-react";

export interface TradeHistoryEntry {
  hash: string;
  block: number;
  side: "buy" | "sell";
  symbol: string;
  tokens: number;
  usd: number;
  /** usdc / eth = amount actually paid or received; other = transfer or another token, valued at NAV */
  via: "usdc" | "eth" | "other";
  time: number | null;
}

const fmtTime = (t: number | null) =>
  t === null
    ? "—"
    : new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const viaLabel = (v: TradeHistoryEntry["via"]) => (v === "usdc" ? "USDC" : v === "eth" ? "in ETH" : "est.");

/** Buys and sells of tokenized stocks, read from the wallet's onchain history (works across devices). */
export function TradeHistoryPanel({
  entries,
  loading,
  error,
  since,
}: {
  entries: TradeHistoryEntry[];
  loading: boolean;
  error: string;
  since: string | null;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 space-y-3" id="trade-history">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <History className="h-4 w-4 text-cyan-300" /> Trade history
        </h3>
        <span className="text-[10px] text-slate-500">
          From your onchain transfers{since ? ` since ${new Date(since).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
        </span>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Reading your trades from Base… the first load can take up to 30 seconds.</p>
      ) : error ? (
        <p className="text-xs text-amber-200">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-slate-400">No stock trades found for this wallet yet.</p>
      ) : (
        <>
        <div className="sm:hidden divide-y divide-slate-800/60">
          {entries.map((e, i) => (
            <div key={`m-${e.hash}-${e.symbol}-${e.side}-${i}`} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className={`font-bold ${e.side === "buy" ? "text-emerald-300" : "text-rose-300"}`}>{e.side === "buy" ? "Buy" : "Sell"}</span>
                  <span className="font-semibold text-white">{e.symbol}</span>
                  <span className="font-mono text-[10px] text-slate-500">{e.tokens.toFixed(6)}</span>
                </div>
                <div className="text-[10px] text-slate-500">{fmtTime(e.time)}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-xs text-slate-200">
                  {fmtUsd(e.usd)} <span className="font-sans text-[10px] text-slate-500">{viaLabel(e.via)}</span>
                </div>
                <a
                  href={`https://basescan.org/tx/${e.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-cyan-300"
                  aria-label={`View ${e.side} of ${e.symbol} on BaseScan`}
                >
                  BaseScan <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="py-1.5">Date</th>
                <th className="py-1.5">Side</th>
                <th className="py-1.5">Stock</th>
                <th className="py-1.5 text-right hidden sm:table-cell">Tokens</th>
                <th className="py-1.5 text-right">Value</th>
                <th className="py-1.5 text-right">Tx</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {entries.map((e, i) => (
                <tr key={`${e.hash}-${e.symbol}-${e.side}-${i}`} className="border-b border-slate-800/60">
                  <td className="py-1.5 font-sans text-slate-400 whitespace-nowrap">{fmtTime(e.time)}</td>
                  <td className={`py-1.5 font-sans font-bold ${e.side === "buy" ? "text-emerald-300" : "text-rose-300"}`}>
                    {e.side === "buy" ? "Buy" : "Sell"}
                  </td>
                  <td className="py-1.5 font-sans font-semibold text-white">{e.symbol}</td>
                  <td className="py-1.5 text-right text-slate-300 hidden sm:table-cell">{e.tokens.toFixed(6)}</td>
                  <td className="py-1.5 text-right text-slate-300 whitespace-nowrap">
                    {fmtUsd(e.usd)}
                    <span className="ml-1 font-sans text-[10px] text-slate-500">{viaLabel(e.via)}</span>
                  </td>
                  <td className="py-1.5 text-right">
                    <a
                      href={`https://basescan.org/tx/${e.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"
                      aria-label={`View ${e.side} of ${e.symbol} on BaseScan`}
                    >
                      {e.hash.slice(0, 6)}… <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length >= 50 && <p className="mt-2 text-[10px] text-slate-500">Showing the 50 most recent trades.</p>}
        </>
      )}
    </div>
  );
}
