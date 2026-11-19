"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw, Sparkles, Wallet } from "lucide-react";
import { stopDriftAlerts } from "@/components/DriftAlerts";
import { STOCK_COLOR_MAP } from "@/components/PortfolioDonutChart";
import { RebalancePanel } from "@/components/RebalancePanel";
import { OnchainActivityEntry, OnchainActivityLogPanel } from "@/components/StockMaxxUxWidgets";
import { TargetWatch, type RebalanceLogEntry } from "@/components/TargetWatch";
import { TradeHistoryPanel, type TradeHistoryEntry } from "@/components/TradeHistoryPanel";
import { type BasketLeg, type SellLeg } from "@/lib/basketExecutor";
import { computeDrift, driftSummary, type Drift, type SavedTarget } from "@/lib/drift";
import {
  BASE_TOKENIZED_STOCKS,
  LiveTokenizedStock,
  PROGRAMMABLE_INDEX_PRESETS,
} from "@/lib/tokenizedStocks";

const DEMO_PORTFOLIO_SPECS: { symbol: string; targetUsd: number; costFactor: number }[] = [
  { symbol: "NVDAc", targetUsd: 520, costFactor: 0.91 },
  { symbol: "MSFTc", targetUsd: 160, costFactor: 0.95 },
  { symbol: "GOOGLc", targetUsd: 160, costFactor: 1.03 },
  { symbol: "TSLAc", targetUsd: 160, costFactor: 0.89 },
];
const DEMO_USDC_BALANCE = 250;
const DEMO_TARGET_PRESET = PROGRAMMABLE_INDEX_PRESETS[0];
const DEMO_TARGET_MAX_PCT = 35;

export interface PortfolioPositionRow {
  st: LiveTokenizedStock;
  rawTokens: number;
  sharesUI: number;
  usdValue: number;
  avgCostUsd: number | null;
  plUsd: number | null;
  plPct: number | null;
  estimated?: boolean;
}

const fmtSignedUsd = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(Math.abs(n) < 1 ? 4 : 2)}`;
const plTone = (n: number) => (n > 0 ? "text-emerald-300" : n < 0 ? "text-rose-300" : "text-slate-300");

function buildDemoPortfolio(stocks: LiveTokenizedStock[]) {
  const balances: Record<string, { rawTokens: number; sharesUI: number; usdValue: number }> = {};
  const rows: PortfolioPositionRow[] = [];
  let totalCost = 0;

  for (const spec of DEMO_PORTFOLIO_SPECS) {
    const st = stocks.find((s) => s.symbol === spec.symbol);
    if (!st || !(st.navPrice > 0)) continue;
    const rawTokens = spec.targetUsd / st.navPrice;
    const mult = st.uiMultiplier || 1;
    const sharesUI = rawTokens * mult;
    const usdValue = rawTokens * st.navPrice;
    const avgCostUsd = st.navPrice * spec.costFactor;
    const cost = avgCostUsd * rawTokens;
    const plUsd = usdValue - cost;
    const plPct = cost > 0 ? (plUsd / cost) * 100 : 0;
    totalCost += cost;
    balances[st.symbol] = { rawTokens, sharesUI, usdValue };
    rows.push({ st, rawTokens, sharesUI, usdValue, avgCostUsd, plUsd, plPct });
  }

  const totalUsd = rows.reduce((a, r) => a + r.usdValue, 0);
  const totalPl = totalUsd - totalCost;
  return { balances, rows, totalUsd, totalCost, totalPl };
}

function PortfolioPositionsView({
  mode,
  rows,
  usdcBalance,
  ethBalance,
  ethUsd,
  totalUsd,
  totalCost,
  totalPl,
  hasPnl,
  realizedPlUsd,
  anyEst,
  pnlPlaceholder,
  balancesError,
  onRetryBalances,
  pnlErrorNote,
  basketPending,
  onBuyMore,
  onSell,
  onDemoAction,
  onEmptyCta,
}: {
  mode: "real" | "demo";
  rows: PortfolioPositionRow[];
  usdcBalance: number | null;
  ethBalance: number | null;
  ethUsd: number | null;
  totalUsd: number;
  totalCost: number;
  totalPl: number;
  hasPnl: boolean;
  realizedPlUsd: number | null;
  anyEst: boolean;
  pnlPlaceholder: string;
  balancesError?: string;
  onRetryBalances?: () => void;
  pnlErrorNote?: string;
  basketPending?: boolean;
  onBuyMore: (symbol: string) => void;
  onSell?: (row: PortfolioPositionRow, pct: number) => void;
  onDemoAction?: (message: string) => void;
  onEmptyCta?: () => void;
}) {
  const multSharesBoost = rows.reduce((a, r) => a + Math.max(0, r.sharesUI - r.rawTokens), 0);
  const multUsdGain = rows.reduce(
    (a, r) => a + (r.st.uiMultiplier > 1.00001 ? r.usdValue * (1 - 1 / r.st.uiMultiplier) : 0),
    0
  );
  const topHold = rows.reduce<{ symbol: string; pct: number } | null>((best, r) => {
    const pct = totalUsd > 0 ? (r.usdValue / totalUsd) * 100 : 0;
    return !best || pct > best.pct ? { symbol: r.st.symbol, pct } : best;
  }, null);

  return (
    <div className="space-y-3">
      {mode === "real" && balancesError && onRetryBalances && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <span>{balancesError}</span>
          <button
            onClick={onRetryBalances}
            className="rounded-lg border border-amber-400/40 px-2.5 py-1 font-semibold text-white hover:bg-amber-500/20 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}
      {rows.length > 0 && (multSharesBoost > 0 || (topHold && topHold.pct > 50)) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {multSharesBoost > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-emerald-200"
              title="Extra share-equivalent earned via B20 dividend/split multiplier (already included in live Stocks value)"
            >
              B20 multiplier captured:{" "}
              <strong className="font-mono tabular-nums text-white">+{multSharesBoost.toFixed(6)} sh</strong>{" "}
              {multUsdGain >= 0.005 && <span className="font-mono tabular-nums text-emerald-300">(≈ ${multUsdGain.toFixed(2)})</span>}
            </span>
          )}
          {topHold && topHold.pct > 50 && (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-amber-200">
              Concentration notice: {topHold.symbol} is {topHold.pct.toFixed(0)}% of your stock value (&gt; 50% in one stock)
            </span>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono tabular-nums">
        <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
          <div className="text-[10px] font-sans text-slate-400">Stocks value</div>
          <div className="text-lg font-extrabold text-white">${totalUsd.toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
          <div className="text-[10px] font-sans text-slate-400">{mode === "demo" ? "Sample USDC" : "USDC on Base"}</div>
          <div className="text-lg font-extrabold text-emerald-300">
            {usdcBalance === null ? "—" : `$${usdcBalance.toFixed(2)}`}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3" title="Stocks at NAV + USDC + ETH">
          <div className="text-[10px] font-sans text-slate-400">Total balance</div>
          <div className="text-lg font-extrabold text-cyan-300">
            ${(totalUsd + (usdcBalance ?? 0) + (ethBalance !== null && ethUsd ? ethBalance * ethUsd : 0)).toFixed(2)}
          </div>
          <div className="text-[10px] font-sans text-slate-500">
            {rows.length} stock{rows.length === 1 ? "" : "s"}
            {ethBalance !== null ? ` · ${ethBalance.toFixed(4)} ETH` : mode === "demo" ? " · sample" : ""}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3" title="Live value minus what you paid (average cost)">
          <div className="text-[10px] font-sans text-slate-400">Unrealized P/L{anyEst ? " (est.)" : ""}</div>
          <div className={`text-lg font-extrabold ${hasPnl && totalCost > 0 ? plTone(totalPl) : "text-slate-300"}`}>
            {hasPnl && totalCost > 0 ? fmtSignedUsd(totalPl) : pnlPlaceholder}
          </div>
          {hasPnl && totalCost > 0 && (
            <div className={`text-[10px] ${plTone(totalPl)}`}>{((totalPl / totalCost) * 100).toFixed(2)}%</div>
          )}
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3" title="Gains or losses already locked in by selling">
          <div className="text-[10px] font-sans text-slate-400">Realized P/L</div>
          <div className={`text-lg font-extrabold ${realizedPlUsd !== null ? plTone(realizedPlUsd) : "text-slate-300"}`}>
            {realizedPlUsd !== null ? fmtSignedUsd(realizedPlUsd) : pnlPlaceholder}
          </div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
          No tokenized stocks in this wallet yet.{" "}
          {onEmptyCta && (
            <button onClick={onEmptyCta} className="text-cyan-300 underline cursor-pointer">
              Buy your first basket
            </button>
          )}
          .
        </div>
      ) : (
        <div className="overflow-x-auto">
          {totalUsd > 0 && (
            <div className="mb-3 space-y-2">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                {rows.map(({ st, usdValue }) => (
                  <div
                    key={st.symbol}
                    style={{ width: `${(usdValue / totalUsd) * 100}%`, backgroundColor: STOCK_COLOR_MAP[st.symbol] || "#4C6FFF" }}
                    title={`${st.symbol} ${((usdValue / totalUsd) * 100).toFixed(1)}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                {rows.map(({ st, usdValue }) => (
                  <span key={st.symbol} className="inline-flex items-center gap-1.5 text-slate-300">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STOCK_COLOR_MAP[st.symbol] || "#4C6FFF" }} />
                    <span className="font-mono">{st.symbol}</span>
                    <span className="font-mono text-slate-500">{((usdValue / totalUsd) * 100).toFixed(0)}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="py-2 pr-3">Stock</th>
                <th className="hidden sm:table-cell py-2 pr-3 text-right">Amount</th>
                <th className="hidden sm:table-cell py-2 pr-3 text-right">NAV</th>
                <th className="py-2 pr-3 text-right">Value</th>
                <th className="hidden sm:table-cell py-2 pr-3 text-right">Avg cost</th>
                <th className="py-2 pr-3 text-right">P/L</th>
                <th className="hidden sm:table-cell py-2 pr-3 text-right">Weight</th>
                <th className="py-2 text-right">{mode === "demo" ? "Preview" : "Trade"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.st.symbol} className="border-b border-slate-800/60 font-mono">
                  <td className="py-2.5 pr-3">
                    <a href={`/stock/${row.st.symbol}`} className="inline-flex items-center gap-2 whitespace-nowrap font-sans font-semibold text-white hover:text-cyan-300">
                      <img src={row.st.logoUrl} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                      {row.st.symbol}
                    </a>
                  </td>
                  <td className="hidden sm:table-cell py-2.5 pr-3 text-right text-slate-300" title="Token amount; the share-equivalent includes reinvested dividends">
                    {row.rawTokens.toFixed(6)}
                    <span className="block text-[10px] text-slate-500">≈ {row.sharesUI.toFixed(6)} sh</span>
                  </td>
                  <td className="hidden sm:table-cell py-2.5 pr-3 text-right text-slate-300">${row.st.navPrice.toFixed(2)}</td>
                  <td className="py-2.5 pr-3 text-right font-bold text-white">${row.usdValue.toFixed(2)}</td>
                  <td className="hidden sm:table-cell py-2.5 pr-3 text-right text-slate-300">
                    {row.avgCostUsd !== null ? `$${row.avgCostUsd.toFixed(2)}` : pnlPlaceholder}
                  </td>
                  <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                    {row.plUsd !== null && row.plPct !== null ? (
                      <span className={plTone(row.plUsd)}>
                        {fmtSignedUsd(row.plUsd)}
                        <span className="block text-[10px]">
                          {row.plPct >= 0 ? "+" : ""}
                          {row.plPct.toFixed(2)}%{row.estimated ? " est." : ""}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-500">{pnlPlaceholder}</span>
                    )}
                  </td>
                  <td className="hidden sm:table-cell py-2.5 pr-3 text-right text-cyan-300">
                    {totalUsd > 0 ? ((row.usdValue / totalUsd) * 100).toFixed(1) : "0.0"}%
                  </td>
                  <td className="py-2.5 text-right font-sans w-[6.75rem] sm:w-auto">
                    {mode === "demo" ? (
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onBuyMore(row.st.symbol)}
                          className="rounded-lg border border-[#4C6FFF]/50 bg-[#4C6FFF]/15 px-2.5 py-1.5 text-[11px] font-bold text-blue-200 hover:bg-[#4C6FFF]/30 cursor-pointer"
                        >
                          Chart
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onDemoAction?.(
                              `Sample only: selling ${row.st.symbol} requires connecting your Base wallet. Live NAV is $${row.st.navPrice.toFixed(2)}.`
                            )
                          }
                          className="rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-slate-500 cursor-pointer"
                        >
                          Sim sell
                        </button>
                      </div>
                    ) : (
                      /* phones: Buy on top, 50% / All below, so the row fits a 390px screen */
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        <button
                          onClick={() => onBuyMore(row.st.symbol)}
                          title={`Buy more ${row.st.symbol}`}
                          className="rounded-lg border border-[#4C6FFF]/50 bg-[#4C6FFF]/15 px-2.5 py-1.5 text-[11px] font-bold text-blue-200 hover:bg-[#4C6FFF]/30 cursor-pointer"
                        >
                          Buy
                        </button>
                        {[
                          { label: "50%", pct: 0.5 },
                          { label: "All", pct: 1 },
                        ].map((o) => (
                          <button
                            key={o.label}
                            onClick={() => onSell?.(row, o.pct)}
                            disabled={Boolean(basketPending) || row.usdValue * o.pct < 0.25}
                            title={
                              row.usdValue * o.pct < 0.25
                                ? "Minimum sell value is $0.25"
                                : `Sell ${o.label} of ${row.st.symbol} for USDC`
                            }
                            className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-bold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40 cursor-pointer"
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            {mode === "demo"
              ? "Sample holdings and cost basis are simulated for preview only, while NAV prices and B20 multipliers come live from /api/stocks. Nothing is saved to localStorage or sent onchain."
              : `P/L uses the USDC or ETH you actually paid, read from your onchain history, against the live Chainlink NAV.${
                  anyEst
                    ? " est. = part of the cost is valued at the Chainlink NAV when the stock arrived (bought with another token, sent from another wallet, or bought before the history scanned so far)."
                    : ""
                }${pnlErrorNote ? ` ${pnlErrorNote}` : ""}`}
          </p>
        </div>
      )}
    </div>
  );
}

export interface PortfolioTabProps {
  walletAddress: string;
  stocks: LiveTokenizedStock[];
  loadingStocks: boolean;
  balancesFor: string;
  balancesError: string;
  walletBalances: Record<string, { rawTokens: number; sharesUI: number; usdValue: number; b20Authorized?: boolean }>;
  usdcBalance: number | null;
  ethBalance: number | null;
  ethUsd: number | null;
  pnl: {
    for: string;
    error: string;
    data: {
      since: string | null;
      complete: boolean;
      realizedUsd: number;
      positions: { symbol: string; avgCostUsd: number | null; realizedUsd: number; estimated: boolean }[];
      activity?: TradeHistoryEntry[];
    } | null;
  };
  savedTarget: SavedTarget | null;
  targetDrift: Drift | null;
  targetReady: boolean;
  rebalanceLog: RebalanceLogEntry[];
  rebalanceBuyDoneNonce: number;
  rebalanceUsdcBaseline: number | null;
  basketPending: boolean;
  activityLog: OnchainActivityEntry[];
  onClearActivityLog: () => void;
  onRefreshStocks: (wallet?: string) => void;
  onOpenWalletMenu: () => void;
  onSaveTarget: (t: SavedTarget | null) => void;
  onBuyStocks: (legs: BasketLeg[], label: string) => void;
  onSellStocks: (legs: SellLeg[], label: string) => void;
  onGoToTerminal: (symbol?: string) => void;
  onGoToAgent: () => void;
}

export default function PortfolioTab({
  walletAddress,
  stocks,
  loadingStocks,
  balancesFor,
  balancesError,
  walletBalances,
  usdcBalance,
  ethBalance,
  ethUsd,
  pnl,
  savedTarget,
  targetDrift,
  targetReady,
  rebalanceLog,
  rebalanceBuyDoneNonce,
  rebalanceUsdcBaseline,
  basketPending,
  activityLog,
  onClearActivityLog,
  onRefreshStocks,
  onOpenWalletMenu,
  onSaveTarget,
  onBuyStocks,
  onSellStocks,
  onGoToTerminal,
  onGoToAgent,
}: PortfolioTabProps) {
  const [demoPortfolio, setDemoPortfolio] = useState<boolean>(false);
  const [demoActionMsg, setDemoActionMsg] = useState<string>("");

  useEffect(() => {
    if (walletAddress) {
      setDemoPortfolio(false);
      setDemoActionMsg("");
    }
  }, [walletAddress]);

  const showDemo = demoPortfolio && !walletAddress;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Holdings */}
      <div className="lg:col-span-12 rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Your tokenized stocks</h2>
            <p className="text-xs text-slate-400">
              Read live from Base for your connected wallet. Values use the Chainlink NAV.
            </p>
          </div>
          {walletAddress ? (
            <button
              onClick={() => onRefreshStocks(walletAddress)}
              disabled={loadingStocks}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingStocks ? "animate-spin" : ""}`} />
              Refresh
            </button>
          ) : (
            <button
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
                onOpenWalletMenu();
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[#4C6FFF] px-4 py-2 text-xs font-bold text-white hover:brightness-110 transition cursor-pointer"
            >
              <Wallet className="h-3.5 w-3.5" />
              Connect wallet
            </button>
          )}
        </div>

        {savedTarget && targetReady && (
          <TargetWatch
            target={savedTarget}
            drift={targetDrift}
            stocks={stocks}
            balances={walletBalances}
            usdcBalance={usdcBalance}
            pending={basketPending}
            onSell={onSellStocks}
            onBuy={onBuyStocks}
            onRemove={() => {
              onSaveTarget(null);
              void stopDriftAlerts();
            }}
            onChangeAlert={(p) => onSaveTarget({ ...savedTarget, alertPct: p })}
            walletAddress={walletAddress}
            history={rebalanceLog}
            rebalanceBuyDoneNonce={rebalanceBuyDoneNonce}
            rebalanceUsdcBaseline={rebalanceUsdcBaseline}
          />
        )}

        {!walletAddress ? (
          !showDemo ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400 space-y-3">
              <p className="text-sm text-slate-200">Connect a wallet to see your holdings.</p>
              <ul className="mx-auto max-w-md space-y-1 text-left text-[11px] text-slate-400 list-disc pl-5">
                <li>Each tokenized stock you hold, valued at the live Chainlink NAV</li>
                <li>Profit / loss since you bought, from the USDC or ETH you actually paid</li>
                <li>Your buy and sell history, with a BaseScan link for every trade</li>
                <li>One-click sell, and rebalancing toward an agent basket</li>
              </ul>
              <p className="text-[11px] text-slate-500">Read-only: connecting never moves funds. No stocks yet?</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => onGoToTerminal()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3.5 py-2 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-white cursor-pointer"
                >
                  Browse the 10 stocks
                </button>
                <button
                  type="button"
                  data-testid="try-demo-portfolio"
                  onClick={() => {
                    setDemoActionMsg("");
                    setDemoPortfolio(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#4C6FFF]/50 bg-[#4C6FFF]/15 px-3.5 py-2 text-xs font-bold text-blue-200 hover:bg-[#4C6FFF]/25 cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Try sample portfolio (demo)
                </button>
              </div>
            </div>
          ) : (() => {
            const demo = buildDemoPortfolio(stocks);
            const demoTargets = DEMO_TARGET_PRESET.allocations
              .map((a) => {
                const b20 = (
                  stocks.find((s) => s.symbol === a.symbol) ??
                  BASE_TOKENIZED_STOCKS.find((s) => s.symbol === a.symbol)
                )?.b20Address;
                return b20 ? { symbol: a.symbol, b20Address: b20, weightBps: a.weightBps } : null;
              })
              .filter((x): x is { symbol: string; b20Address: `0x${string}`; weightBps: number } => x !== null);
            const demoDrift =
              demoTargets.length > 0
                ? computeDrift(
                    Object.entries(demo.balances).map(([symbol, b]) => ({ symbol, usd: b.usdValue })),
                    demoTargets,
                    DEMO_TARGET_MAX_PCT
                  )
                : null;

            return (
              <div className="space-y-4">
                <div
                  data-testid="demo-portfolio-banner"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#4C6FFF]/40 bg-[#4C6FFF]/10 px-4 py-3 text-xs"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-[#4C6FFF]/25 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-blue-200">
                        Demo preview · live NAVs
                      </span>
                      <span className="font-semibold text-white">Simulated $1,000 basket + $250 USDC</span>
                    </div>
                    <p className="text-[11px] text-slate-300">
                      Valued from live Chainlink NAVs and B20 multipliers. No wallet connected; nothing is saved or sent.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={onOpenWalletMenu}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#4C6FFF] px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500 cursor-pointer"
                    >
                      <Wallet className="h-3.5 w-3.5" />
                      Connect real wallet
                    </button>
                    <button
                      type="button"
                      data-testid="exit-demo-portfolio"
                      onClick={() => {
                        setDemoPortfolio(false);
                        setDemoActionMsg("");
                      }}
                      className="rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 cursor-pointer"
                    >
                      Exit demo
                    </button>
                  </div>
                </div>

                {demoActionMsg && (
                  <div
                    role="status"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200"
                  >
                    <span>{demoActionMsg}</span>
                    <button
                      type="button"
                      onClick={() => setDemoActionMsg("")}
                      className="text-cyan-300 hover:text-white cursor-pointer"
                      aria-label="Dismiss demo notice"
                    >
                      ✕
                    </button>
                  </div>
                )}

                <PortfolioPositionsView
                  mode="demo"
                  rows={demo.rows}
                  usdcBalance={DEMO_USDC_BALANCE}
                  ethBalance={null}
                  ethUsd={ethUsd}
                  totalUsd={demo.totalUsd}
                  totalCost={demo.totalCost}
                  totalPl={demo.totalPl}
                  hasPnl={demo.totalCost > 0}
                  realizedPlUsd={0}
                  anyEst={false}
                  pnlPlaceholder="—"
                  onBuyMore={(symbol) => onGoToTerminal(symbol)}
                  onDemoAction={(msg) => setDemoActionMsg(msg)}
                />

                {demoDrift && (
                  <div data-testid="demo-rebalance" className="rounded-2xl border border-amber-500/35 bg-[#070b14] p-4 space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-amber-200">
                          Sample target drift · {DEMO_TARGET_PRESET.name} ({DEMO_TARGET_PRESET.ticker})
                        </h3>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          Drift <strong className="font-mono text-white">{demoDrift.driftPct.toFixed(1)}%</strong> ·{" "}
                          {driftSummary(demoDrift, DEMO_TARGET_MAX_PCT)} (cap {DEMO_TARGET_MAX_PCT}% per stock)
                        </p>
                      </div>
                    </div>
                    <RebalancePanel
                      stocks={stocks}
                      balances={demo.balances}
                      usdcBalance={DEMO_USDC_BALANCE}
                      targets={demoTargets}
                      targetLabel={`${DEMO_TARGET_PRESET.ticker} (Demo)`}
                      pending={false}
                      onSell={() =>
                        setDemoActionMsg(
                          "Sample preview only — Step 1 would prepare USDC sales for overweight stocks once a real Base wallet is connected."
                        )
                      }
                      onBuy={() =>
                        setDemoActionMsg(
                          "Sample preview only — Step 2 would prepare Basket buys for underweight stocks once a real Base wallet is connected."
                        )
                      }
                      maxWeightPct={DEMO_TARGET_MAX_PCT}
                    />
                  </div>
                )}
              </div>
            );
          })()
        ) : balancesFor !== walletAddress.toLowerCase() ? (
          <div className="space-y-3" aria-busy="true">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[62px] rounded-xl border border-slate-800 bg-[#070b14] animate-pulse" />
              ))}
            </div>
            {balancesError && !loadingStocks ? (
              <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-dashed border-amber-500/40 p-6 text-xs text-amber-200">
                {balancesError}
                <button
                  onClick={() => onRefreshStocks(walletAddress)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-800 p-6 text-xs text-slate-400">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Reading your balances from Base…
              </div>
            )}
          </div>
        ) : (() => {
          const pnlData = pnl.for === walletAddress.toLowerCase() ? pnl.data : null;
          const pnlPending = pnl.for !== walletAddress.toLowerCase();
          const rows: PortfolioPositionRow[] = stocks
            .map((st) => {
              const bal = walletBalances[st.symbol];
              const rawTokens = bal?.rawTokens ?? 0;
              const sharesUI = bal?.sharesUI ?? 0;
              const usdValue = bal?.usdValue ?? 0;
              const pos = pnlData?.positions.find((x) => x.symbol === st.symbol);
              const avgCostUsd = typeof pos?.avgCostUsd === "number" ? pos.avgCostUsd : null;
              const costUsd = avgCostUsd !== null ? avgCostUsd * rawTokens : null;
              const plUsd = costUsd !== null ? usdValue - costUsd : null;
              const plPct = costUsd !== null ? (costUsd > 0 ? ((usdValue - costUsd) / costUsd) * 100 : 0) : null;
              return {
                st,
                rawTokens,
                sharesUI,
                usdValue,
                avgCostUsd,
                plUsd,
                plPct,
                estimated: Boolean(pos?.estimated),
              };
            })
            .filter((r) => r.rawTokens > 0);
          const totalUsd = rows.reduce((a, r) => a + r.usdValue, 0);
          const totalCost = rows.reduce(
            (a, r) => a + (r.avgCostUsd !== null ? r.avgCostUsd * r.rawTokens : 0),
            0
          );
          const totalPl = rows.reduce((a, r) => a + (r.plUsd ?? 0), 0);
          const anyEst = rows.some((r) => r.plUsd !== null && r.estimated);
          const pnlPlaceholder = pnlPending ? "…" : "—";

          return (
            <PortfolioPositionsView
              mode="real"
              rows={rows}
              usdcBalance={usdcBalance}
              ethBalance={ethBalance}
              ethUsd={ethUsd}
              totalUsd={totalUsd}
              totalCost={totalCost}
              totalPl={totalPl}
              hasPnl={Boolean(pnlData)}
              realizedPlUsd={pnlData ? pnlData.realizedUsd : null}
              anyEst={anyEst}
              pnlPlaceholder={pnlPlaceholder}
              balancesError={balancesError}
              onRetryBalances={() => onRefreshStocks(walletAddress)}
              pnlErrorNote={pnl.for === walletAddress.toLowerCase() ? pnl.error : ""}
              basketPending={basketPending}
              onBuyMore={(symbol) => {
                onGoToTerminal(symbol);
                setTimeout(() => document.getElementById("swap-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 350);
              }}
              onSell={(row, pct) =>
                onSellStocks(
                  [{ symbol: row.st.symbol, b20Address: row.st.b20Address, tokens: row.rawTokens * pct }],
                  row.st.symbol
                )
              }
              onEmptyCta={onGoToAgent}
            />
          );
        })()}
      </div>

      {/* Trade history rebuilt from the wallet's onchain transfers (same scan as P/L) */}
      {walletAddress && (
        <div className="lg:col-span-12">
          <TradeHistoryPanel
            entries={pnl.for === walletAddress.toLowerCase() ? pnl.data?.activity ?? [] : []}
            loading={pnl.for !== walletAddress.toLowerCase() && (!balancesError || loadingStocks)}
            error={
              pnl.for === walletAddress.toLowerCase()
                ? pnl.error
                : balancesError && !loadingStocks
                ? balancesError
                : ""
            }
            since={pnl.for === walletAddress.toLowerCase() ? pnl.data?.since ?? null : null}
          />
        </div>
      )}

      {/* Activity from this browser (only once something was sent from here) */}
      {activityLog.length > 0 && (
        <div className="lg:col-span-12">
          <OnchainActivityLogPanel entries={activityLog} onClear={onClearActivityLog} />
        </div>
      )}

      <p className="lg:col-span-12 text-[11px] text-slate-500 leading-relaxed">
        MAXXAGENT transactions carry a public{" "}
        <span className="text-slate-400">ERC-8021 Builder Code</span> so activity can be attributed to this app.
        It contains no personal data and you can see it in each transaction&apos;s input data on BaseScan.
      </p>
    </div>
  );
}
