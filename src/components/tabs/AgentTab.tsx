"use client";

import React from "react";
import { Bot, Code2, Copy, Layers, Sparkles, Zap } from "lucide-react";
import { AgentTrace } from "@/components/AgentTrace";
import { BasketReplay } from "@/components/BasketReplay";
import { MaxxAgentMark } from "@/components/BrandLogo";
import { PortfolioDonutChart, STOCK_COLOR_MAP, STOCK_LOGO_MAP } from "@/components/PortfolioDonutChart";
import { RebalancePanel } from "@/components/RebalancePanel";
import { BasketSnapshotCard } from "@/components/StockMaxxUxWidgets";
import { UsdAmountInput } from "@/components/UsdAmountInput";
import { AgentAnalysisReport } from "@/lib/agentEngine";
import { type BasketLeg, type BasketResult, type SellLeg } from "@/lib/basketExecutor";
import { type SavedTarget } from "@/lib/drift";
import { basketToQuery } from "@/lib/shareBasket";
import { LiveTokenizedStock, MIN_BUY_USD } from "@/lib/tokenizedStocks";

export interface AgentTabProps {
  publicSiteUrl: string;
  stocks: LiveTokenizedStock[];
  userPrompt: string;
  setUserPrompt: (s: string) => void;
  riskProfile: "Conservative" | "Balanced" | "Aggressive";
  setRiskProfile: (r: "Conservative" | "Balanced" | "Aggressive") => void;
  capitalUsd: number;
  setCapitalUsd: (n: number) => void;
  runningAgent: boolean;
  agentError: string;
  agentReport: AgentAnalysisReport | null;
  mandateHistory: string[];
  followUpPrompt: string;
  setFollowUpPrompt: (s: string) => void;
  triggerStockAgent: (
    stocksData?: LiveTokenizedStock[],
    promptOverride?: string,
    options?: { followUp?: string; riskOverride?: "Conservative" | "Balanced" | "Aggressive" }
  ) => void;
  basketUsd: number;
  setBasketUsd: (n: number) => void;
  basketPayWith: "usdc" | "eth";
  payLabel: string;
  payToggle: React.ReactNode;
  basketPending: boolean;
  basketStatus: string;
  basketError: string;
  basketResult: BasketResult | null;
  buyStocks: (legs: BasketLeg[], label: string) => void;
  sellStocks: (legs: SellLeg[], label: string) => void;
  savedTarget: SavedTarget | null;
  saveTarget: (t: SavedTarget | null) => void;
  walletAddress: string;
  balancesFor: string;
  walletBalances: Record<string, { rawTokens: number; sharesUI: number; usdValue: number; b20Authorized?: boolean }>;
  usdcBalance: number | null;
  rebalanceBuyDoneNonce: number;
  rebalanceUsdcBaseline: number | null;
  highlightedAlloc: string | null;
  setHighlightedAlloc: React.Dispatch<React.SetStateAction<string | null>>;
  copiedKey: string;
  copyToClipboard: (text: string, key: string) => void;
  shareLinkFor: (weightsBps: Record<string, number>) => string;
  hasRegistry: boolean;
  txPending: boolean;
  publishStatus: string;
  publishIndexOnchain: (
    name: string,
    ticker: string,
    legs: { b20Address: string; weightBps: number }[]
  ) => void;
  studioMode: boolean;
  proMode: boolean;
  setProMode: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function AgentTab({
  publicSiteUrl,
  stocks,
  userPrompt,
  setUserPrompt,
  riskProfile,
  setRiskProfile,
  capitalUsd,
  setCapitalUsd,
  runningAgent,
  agentError,
  agentReport,
  mandateHistory,
  followUpPrompt,
  setFollowUpPrompt,
  triggerStockAgent,
  basketUsd,
  setBasketUsd,
  basketPayWith,
  payLabel,
  payToggle,
  basketPending,
  basketStatus,
  basketError,
  basketResult,
  buyStocks,
  sellStocks,
  savedTarget,
  saveTarget,
  walletAddress,
  balancesFor,
  walletBalances,
  usdcBalance,
  rebalanceBuyDoneNonce,
  rebalanceUsdcBaseline,
  highlightedAlloc,
  setHighlightedAlloc,
  copiedKey,
  copyToClipboard,
  shareLinkFor,
  hasRegistry,
  txPending,
  publishStatus,
  publishIndexOnchain,
  studioMode,
  proMode,
  setProMode,
}: AgentTabProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: Agent Configuration & Strategy Prompt */}
      <div className="lg:col-span-5 space-y-5 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4C6FFF]/20 border border-[#4C6FFF]/40">
                <Bot className="h-6 w-6 text-blue-300" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">MAXXAGENT basket agent</h2>
                <p className="text-xs text-slate-400">
                  Transparent rules over live onchain data — you decide and sign
                </p>
              </div>
            </div>
          </div>

          {/* Quick Strategy Prompts */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Quick Research Mandates
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[
                {
                  label: "AI & GPU Compute",
                  logo: "/logos/stocks/NVDAc.png",
                  prompt:
                    "AI and cloud compute leaders (NVDAc, MSFTc, GOOGLc, SNDKc), prefer stocks trading below NAV",
                },
                {
                  label: "Frontier tech",
                  logo: "/logos/stocks/SPCXc.png",
                  prompt:
                    "High-beta frontier innovation basket targeting SpaceX (SPCXc), Tesla robotics (TSLAc), and Bitcoin treasury (MSTRc)",
                },
                {
                  label: "Defensive mega-caps",
                  logo: "/logos/stocks/AAPLc.png",
                  prompt:
                    "Defensive, lower-beta mega-caps (AAPLc, MSFTc, AMZNc, GOOGLc)",
                },
                {
                  label: "Big tech, no crypto",
                  logo: "/logos/stocks/MSFTc.png",
                  prompt: "Big tech, equal weight, 4 stocks, no crypto",
                },
                {
                  label: "AI with limits",
                  logo: "/logos/stocks/GOOGLc.png",
                  prompt: "AI and Netflix, 3 stocks, max 30% per stock",
                },
              ].map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => {
                    setUserPrompt(preset.prompt);
                    triggerStockAgent(stocks, preset.prompt);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-1.5 text-xs text-slate-200 hover:border-[#4C6FFF] hover:bg-[#4C6FFF]/15 transition cursor-pointer"
                >
                  <img src={preset.logo} alt="" className="h-4 w-4 rounded-full" />
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Natural Language Mandate Input */}
          <div className="space-y-1.5">
            <label htmlFor="agent-prompt-input" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              What do you want? e.g. &quot;AI and cloud, no Tesla, 3 stocks, equal weight&quot;
            </label>
            <textarea
              id="agent-prompt-input"
              name="agentPrompt"
              rows={3}
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-[#050811] p-3 text-xs text-white placeholder-slate-500 focus:border-[#4C6FFF] focus:outline-none"
              placeholder="Describe your tokenized stock thesis, target sectors, or tickers..."
            />
          </div>

          {/* Risk Profile & Capital */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="agent-risk-profile" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Risk profile
              </label>
              <select
                id="agent-risk-profile"
                name="agentRiskProfile"
                value={riskProfile}
                onChange={(e) =>
                  setRiskProfile(e.target.value as "Conservative" | "Balanced" | "Aggressive")
                }
                className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 text-xs text-white focus:border-[#4C6FFF] focus:outline-none"
              >
                <option value="Conservative">Conservative (Low Beta)</option>
                <option value="Balanced">Balanced</option>
                <option value="Aggressive">Aggressive (High Beta)</option>
              </select>
            </div>

            <div>
              <label htmlFor="agent-capital-usd" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Amount to invest (USD)
              </label>
              <UsdAmountInput
                id="agent-capital-usd"
                value={capitalUsd}
                onChange={setCapitalUsd}
                min={0}
                className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 font-mono text-xs text-white focus:border-[#4C6FFF] focus:outline-none"
                ariaLabel="Amount to invest in USD"
              />
            </div>
          </div>

          {/* Not financial advice */}
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            Not financial advice. The agent proposes allocations from live onchain data using
            transparent rules; you decide and sign every transaction from your own wallet. No
            returns are promised. Tokenized stocks are for eligible non-US persons only.
          </p>

          <button
            onClick={() => triggerStockAgent()}
            disabled={runningAgent}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#4C6FFF] to-cyan-600 px-4 py-3 text-xs font-bold text-white shadow-lg shadow-[#4C6FFF]/30 hover:opacity-95 transition cursor-pointer"
          >
            <Sparkles className="h-4 w-4" />
            {runningAgent ? "Analysing live data…" : "Run agent"}
          </button>
        </div>
      </div>

      {/* Right column: the agent's proposed basket */}
      <div className="lg:col-span-7 space-y-5">
        {agentError && !runningAgent && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200" role="alert">
            {agentError}
          </div>
        )}
        {!agentReport && !runningAgent && (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-[#0b1120] p-8 text-center text-sm text-slate-400">
            Run the agent to get a proposed basket from live NAV, DEX prices and liquidity.
          </div>
        )}
        {(agentReport || runningAgent) && <AgentTrace report={runningAgent ? null : agentReport} running={runningAgent} />}
        {agentReport && !runningAgent && agentReport.allocations.length > 0 && (
          <BasketReplay legs={agentReport.allocations.map((a) => ({ symbol: a.symbol, pct: a.capitalSharePct }))} />
        )}
        {agentReport && (
          <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 sm:p-6 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <MaxxAgentMark size={18} />
                  <span className="rounded-md bg-[#4C6FFF]/20 border border-[#4C6FFF]/40 px-2.5 py-0.5 font-mono text-xs font-semibold text-blue-300">
                    {agentReport.strategyName}
                  </span>
                  <span className="text-[11px] text-slate-500">{agentReport.allocations.length} stocks</span>
                </div>
                <p className="mt-2 text-xs text-slate-300 leading-relaxed">{agentReport.executiveSummary}</p>
                {agentReport.interpretation?.length > 0 && (
                  <div className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-3 py-2" data-testid="agent-interpretation">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">How I read your request</div>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-slate-300 list-disc pl-4">
                      {agentReport.interpretation.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {agentReport.limits?.length > 0 && (
                  <div className="mt-3 rounded-xl border border-slate-700 bg-[#070b14] px-3 py-2" data-testid="agent-limits">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Your limits</div>
                    <ul className="mt-1 space-y-1 text-[11px]">
                      {agentReport.limits.map((l) => (
                        <li key={l.label} className="flex gap-2">
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              l.status === "kept"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : l.status === "adjusted"
                                ? "bg-amber-500/15 text-amber-300"
                                : "bg-rose-500/15 text-rose-300"
                            }`}
                          >
                            {l.status === "kept" ? "Kept" : l.status === "adjusted" ? "Adjusted" : "Not supported"}
                          </span>
                          <span className="text-slate-300">
                            <strong className="text-white">{l.label}.</strong> {l.detail}
                            {l.link && (
                              <>
                                {" "}
                                <a href={l.link.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline hover:text-white">
                                  {l.link.label}
                                </a>
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(agentReport.cautions?.length ?? 0) > 0 && (
                  <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2" data-testid="agent-cautions">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Check before buying</div>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-slate-300">
                      {agentReport.cautions!.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`https://x.com/intent/tweet?text=${encodeURIComponent(
                    `My MAXXAGENT basket of tokenized stocks on @base:\n${agentReport.allocations
                      .slice(0, 5)
                      .map((a) => `• $${a.symbol}: ${(a.targetWeightBps / 100).toFixed(0)}%`)
                      .join("\n")}\n\nBuy the same basket: ${publicSiteUrl}/?${basketToQuery(
                      Object.fromEntries(agentReport.allocations.map((a) => [a.symbol, a.targetWeightBps]))
                    )}\n\nNot financial advice. #StocksMaxxing @buildonbase`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2.5 text-xs font-bold text-slate-200 hover:border-blue-400 hover:text-white transition"
                  title="Share your AI B20 Strategy on X (@buildonbase)"
                >
                  <img src="/logos/brands/x.svg" alt="X" className="h-3.5 w-3.5" />
                  Share on X
                </a>
                <button
                  onClick={() =>
                    copyToClipboard(
                      shareLinkFor(Object.fromEntries(agentReport.allocations.map((a) => [a.symbol, a.targetWeightBps]))),
                      "share-agent"
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2.5 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-white transition cursor-pointer"
                  title="Copy a link that opens this basket for anyone"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copiedKey === "share-agent" ? "Link copied!" : "Copy share link"}
                </button>
                {hasRegistry && (
                  <button
                    onClick={() =>
                      publishIndexOnchain(
                        agentReport.strategyName,
                        agentReport.strategyTicker,
                        agentReport.allocations.map((a) => ({
                          b20Address: a.b20Address,
                          weightBps: a.targetWeightBps,
                        }))
                      )
                    }
                    disabled={txPending || !hasRegistry}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#4C6FFF]/50 bg-[#4C6FFF]/20 px-3.5 py-2.5 text-xs font-bold text-blue-200 hover:bg-[#4C6FFF]/35 disabled:opacity-50 transition cursor-pointer"
                    title={hasRegistry ? "Publish these weights to StockMaxxIndexRegistry so others can buy the same basket" : "Index registry not deployed yet"}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    {txPending ? publishStatus || "Confirm in wallet…" : "Publish as onchain index"}
                  </button>
                )}
              </div>
            </div>

            {/* Follow-up refinement bar: iterate on the current mandate without starting over */}
            <div data-testid="agent-followup" className="rounded-2xl border border-slate-800 bg-[#070b14] p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                  Refine this basket
                </span>
                {mandateHistory.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="font-mono text-cyan-300">{mandateHistory.length} steps applied</span>
                    <button
                      type="button"
                      onClick={() => {
                        const base = mandateHistory[0] || userPrompt;
                        setFollowUpPrompt("");
                        triggerStockAgent(stocks, base);
                      }}
                      disabled={runningAgent}
                      className="rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10px] font-semibold text-slate-300 hover:border-slate-500 hover:text-white cursor-pointer disabled:opacity-50"
                    >
                      Reset to step 1
                    </button>
                  </div>
                )}
              </div>
              {mandateHistory.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                  {mandateHistory.map((stepText, idx) => (
                    <span
                      key={`${idx}-${stepText}`}
                      className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-800 bg-[#050811] px-2 py-0.5"
                    >
                      <span className="font-mono text-cyan-300">{idx + 1}.</span>
                      <span className="truncate max-w-[210px]">{stepText}</span>
                    </span>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = followUpPrompt.trim();
                  if (!text || runningAgent) return;
                  triggerStockAgent(stocks, undefined, { followUp: text });
                }}
                className="flex gap-2"
              >
                <input
                  id="agent-followup-input"
                  data-testid="agent-followup-input"
                  value={followUpPrompt}
                  onChange={(e) => setFollowUpPrompt(e.target.value.slice(0, 300))}
                  placeholder='Refine: e.g. "no Tesla", "max 25% per stock", "keep 15% cash", "equal weight"'
                  aria-label="Follow-up refinement instruction"
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-[#4C6FFF] focus:outline-none"
                />
                <button
                  type="submit"
                  data-testid="agent-followup-submit"
                  disabled={runningAgent || !followUpPrompt.trim()}
                  className="shrink-0 rounded-xl bg-[#4C6FFF] px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-40 transition cursor-pointer"
                >
                  Refine
                </button>
              </form>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "Max 25% per stock", cmd: "max 25% per stock" },
                  { label: "Equal weight", cmd: "equal weight" },
                  (agentReport.cashReservePct ?? 0) > 0
                    ? { label: "0% cash", cmd: "0% cash" }
                    : { label: "Keep 15% in USDC", cmd: "keep 15% in cash" },
                  { label: "Prefer below NAV", cmd: "prefer below NAV" },
                  { label: "Safer / low vol", cmd: "safer low risk", risk: "Conservative" as const },
                  { label: "No crypto", cmd: "no crypto" },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    disabled={runningAgent}
                    onClick={() => {
                      if (chip.risk) setRiskProfile(chip.risk);
                      triggerStockAgent(stocks, undefined, {
                        followUp: chip.cmd,
                        riskOverride: chip.risk,
                      });
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-[#4C6FFF] hover:text-white disabled:opacity-40 transition cursor-pointer"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Buy this basket in-app */}
            <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/5 p-4 space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white">Buy this basket</h3>
                  <p className="text-[11px] text-slate-400">
                    Best route via DEX aggregator on Base. Stocks go directly to your wallet —
                    MAXXAGENT never holds your funds. Routes costing over 1.5% are skipped.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <label htmlFor="agent-basket-total">Total</label>
                  <span className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <UsdAmountInput
                      id="agent-basket-total"
                      value={basketUsd}
                      onChange={setBasketUsd}
                      min={MIN_BUY_USD}
                      className="w-28 rounded-xl border border-slate-700 bg-[#050811] py-2 pl-6 pr-2 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none"
                      ariaLabel="Basket total in USD"
                    />
                  </span>
                  {payToggle}
                </div>
              </div>

              {(agentReport.cashReservePct ?? 0) > 0 && (
                <p className="text-[11px] text-slate-300">
                  {agentReport.cashReservePct}% stays in your wallet as you asked or to keep your limit: you invest $
                  {((basketUsd * (100 - agentReport.cashReservePct)) / 100).toFixed(2)} of ${basketUsd.toFixed(2)}.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {agentReport.allocations.map((a) => {
                  const legUsd = (basketUsd * ((100 - (agentReport.cashReservePct ?? 0)) / 100) * a.targetWeightBps) / 10000;
                  return (
                    <span
                      key={a.symbol}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] ${
                        legUsd >= MIN_BUY_USD
                          ? "border-slate-700 bg-slate-900 text-slate-200"
                          : "border-slate-800 bg-slate-900/40 text-slate-500 line-through"
                      }`}
                      title={legUsd >= MIN_BUY_USD ? undefined : "Below the $0.50 minimum per stock"}
                    >
                      <img src={a.logoUrl || STOCK_LOGO_MAP[a.symbol]} alt="" className="h-3.5 w-3.5 rounded-full" />
                      {a.symbol} ${legUsd.toFixed(2)}
                    </span>
                  );
                })}
              </div>

              <button
                onClick={() =>
                  buyStocks(
                    agentReport.allocations.map((a) => ({
                      symbol: a.symbol,
                      b20Address: a.b20Address,
                      usd: Math.floor(((basketUsd * ((100 - (agentReport.cashReservePct ?? 0)) / 100) * a.targetWeightBps) / 10000) * 100) / 100,
                      payWith: basketPayWith,
                    })),
                    agentReport.strategyName
                  )
                }
                disabled={basketPending || basketUsd < MIN_BUY_USD}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 disabled:opacity-60 transition cursor-pointer"
              >
                <Zap className="h-4 w-4" />
                {basketPending
                  ? basketStatus || "Working…"
                  : `Buy basket for $${((basketUsd * (100 - (agentReport.cashReservePct ?? 0))) / 100).toFixed(2)} ${payLabel}`}
              </button>

              {(() => {
                const weights = agentReport.allocations.map((a) => ({ symbol: a.symbol, weightBps: a.targetWeightBps }));
                const isCurrent =
                  savedTarget !== null &&
                  JSON.stringify(savedTarget.weights) === JSON.stringify(weights) &&
                  (savedTarget.maxWeightPct ?? undefined) === (agentReport.maxWeightOfStocksPct ?? undefined);
                return (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#070b14] px-3 py-2 text-[11px] text-slate-400">
                    <span>
                      {isCurrent
                        ? "This basket is your target. I check your wallet against it each time you come back."
                        : walletAddress
                        ? "Make this your target and I will tell you when your wallet drifts from it."
                        : "Connect a wallet to keep this basket as your target."}
                    </span>
                    <button
                      onClick={() =>
                        saveTarget({
                          label: agentReport.strategyTicker || agentReport.strategyName,
                          mandate: agentReport.userPrompt,
                          weights,
                          maxWeightPct: agentReport.maxWeightOfStocksPct,
                          savedAt: new Date().toISOString(),
                        })
                      }
                      disabled={!walletAddress || isCurrent || weights.reduce((a, w) => a + w.weightBps, 0) !== 10000}
                      data-testid="save-target"
                      className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-bold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50 cursor-pointer"
                    >
                      {isCurrent ? "Saved as target ✓" : savedTarget ? "Replace my target" : "Set as my target"}
                    </button>
                  </div>
                );
              })()}

              {basketError && (
                <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {basketError}
                </div>
              )}

              {basketResult && (
                <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 space-y-1">
                  <div className="font-bold">
                    Received onchain:{" "}
                    {basketResult.received.length > 0
                      ? basketResult.received
                          .map((r) => `${r.tokens.toFixed(6)} ${r.symbol}${r.quotedTokens ? ` (quoted ${r.quotedTokens.toFixed(6)})` : ""}`)
                          .join(", ")
                      : "reading receipts…"}
                  </div>
                  {basketResult.skipped.length > 0 && (
                    <div className="text-amber-200">
                      Skipped: {basketResult.skipped.map((s) => `${s.symbol} — ${s.error}`).join(" · ")}
                    </div>
                  )}
                  {basketResult.failed?.length > 0 && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-100">
                      Partly completed. Not completed: {basketResult.failed.map((f) => `${f.label} (${f.error})`).join(" · ")}. The other
                      stocks went through.
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {(basketResult.txs.length ? basketResult.txs : basketResult.txHashes.map((h) => ({ hash: h, status: "unknown" as const }))).map((t) => (
                      <a
                        key={t.hash}
                        href={`https://basescan.org/tx/${t.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono underline hover:text-white"
                        title={`Status: ${t.status}`}
                      >
                        <span className={t.status === "confirmed" ? "text-emerald-300" : t.status === "failed" ? "text-rose-300" : "text-slate-400"}>
                          {t.status === "confirmed" ? "✓" : t.status === "failed" ? "✕" : "…"}
                        </span>
                        {t.hash.slice(0, 10)}… on BaseScan
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {walletAddress && balancesFor === walletAddress.toLowerCase() && (
              <RebalancePanel
                key={walletAddress}
                stocks={stocks}
                balances={walletBalances}
                usdcBalance={usdcBalance}
                targets={agentReport.allocations.map((a) => ({ symbol: a.symbol, b20Address: a.b20Address, weightBps: a.targetWeightBps }))}
                targetLabel={agentReport.strategyName}
                pending={basketPending}
                onSell={sellStocks}
                onBuy={buyStocks}
                maxWeightPct={agentReport.maxWeightOfStocksPct}
                rebalanceBuyDoneNonce={rebalanceBuyDoneNonce}
                usdcBaseline={rebalanceUsdcBaseline}
              />
            )}

            <div className="rounded-2xl border border-slate-800/90 bg-[#050914]/90 p-4">
              <PortfolioDonutChart
                items={agentReport.allocations.map((a) => ({
                  symbol: a.symbol,
                  weightBps: a.targetWeightBps,
                  color: a.color || STOCK_COLOR_MAP[a.symbol] || "#4C6FFF",
                  logoUrl: a.logoUrl || STOCK_LOGO_MAP[a.symbol],
                }))}
                centerLabel="Capital"
                centerValue={`$${agentReport.portfolioCapitalUsd.toLocaleString("en-US")}`}
              />
            </div>

            <BasketSnapshotCard allocations={agentReport.allocations} />

            {/* Allocations Table with Interactive Horizontal Allocation Bar */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                Allocation and why each stock was picked
              </h3>

              <div className="mb-3 rounded-xl border border-slate-800/90 bg-[#050914] p-3 space-y-2">
                {(() => {
                  const cashPct = Math.max(0, agentReport.cashReservePct ?? 0);
                  const stockShares = agentReport.allocations.map((a) => Math.max(0, a.capitalSharePct ?? a.targetWeightBps / 100));
                  const rawParts = cashPct > 0 ? [...stockShares, cashPct] : stockShares;
                  const rawTotal = rawParts.reduce((s, v) => s + v, 0) || 100;
                  return (
                    <div className="flex h-6 w-full overflow-hidden rounded-lg bg-slate-900">
                      {agentReport.allocations.map((alloc, idx) => {
                        const sharePct = stockShares[idx];
                        const widthPct = (sharePct / rawTotal) * 100;
                        const isHi = highlightedAlloc === alloc.symbol;
                        return (
                          <button
                            key={`bar-${alloc.symbol}`}
                            type="button"
                            onMouseEnter={() => setHighlightedAlloc(alloc.symbol)}
                            onMouseLeave={() => setHighlightedAlloc(null)}
                            onClick={() => setHighlightedAlloc((prev) => (prev === alloc.symbol ? null : alloc.symbol))}
                            style={{
                              width: `${Math.max(2, widthPct)}%`,
                              backgroundColor: alloc.color || STOCK_COLOR_MAP[alloc.symbol] || "#4C6FFF",
                            }}
                            className={`flex items-center justify-center text-[10px] font-mono font-bold text-white transition-all cursor-pointer border-r border-[#050914]/70 ${
                              highlightedAlloc && !isHi ? "opacity-45" : "opacity-100"
                            }`}
                            title={`${alloc.symbol}: ${sharePct.toFixed(1)}% ($${alloc.usdAllocation.toFixed(2)})`}
                          >
                            {widthPct >= 12 ? `${alloc.symbol.replace(/c$/, "")} ${sharePct.toFixed(1).replace(/\.0$/, "")}%` : ""}
                          </button>
                        );
                      })}
                      {cashPct > 0 && (
                        <div
                          style={{ width: `${(cashPct / rawTotal) * 100}%` }}
                          className="flex items-center justify-center bg-emerald-600/80 text-[10px] font-mono font-bold text-white"
                          title={`USDC cash reserve: ${cashPct.toFixed(1)}%`}
                        >
                          {(cashPct / rawTotal) * 100 >= 12 ? `USDC ${cashPct.toFixed(1).replace(/\.0$/, "")}%` : ""}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400 font-mono tabular-nums">
                  {agentReport.allocations.map((a) => (
                    <button
                      key={`lg-${a.symbol}`}
                      type="button"
                      onMouseEnter={() => setHighlightedAlloc(a.symbol)}
                      onMouseLeave={() => setHighlightedAlloc(null)}
                      onClick={() => setHighlightedAlloc((prev) => (prev === a.symbol ? null : a.symbol))}
                      className={`inline-flex items-center gap-1 cursor-pointer ${highlightedAlloc === a.symbol ? "text-white font-bold" : "hover:text-slate-200"}`}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.color || STOCK_COLOR_MAP[a.symbol] || "#4C6FFF" }} />
                      {a.symbol} {(a.capitalSharePct ?? (a.targetWeightBps / 100)).toFixed(1)}%
                    </button>
                  ))}
                  {(agentReport.cashReservePct ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-emerald-300">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      USDC {agentReport.cashReservePct}%
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {agentReport.allocations.map((alloc) => (
                  <div
                    key={alloc.symbol}
                    className={`rounded-xl border p-4 space-y-2 transition ${
                      highlightedAlloc === alloc.symbol
                        ? "border-cyan-400/70 bg-[#0b1326] ring-1 ring-cyan-400/40"
                        : "border-slate-800/90 bg-[#070b14]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <img
                          src={alloc.logoUrl || STOCK_LOGO_MAP[alloc.symbol]}
                          alt={alloc.companyName}
                          className="h-8 w-8 rounded-full border border-slate-700 bg-slate-900 object-cover"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-white">{alloc.symbol}</span>
                            <span className="hidden sm:inline text-xs text-slate-400">{alloc.companyName}</span>
                            <span
                              className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                                alloc.action === "ACCUMULATE"
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : alloc.action === "TRIM"
                                  ? "bg-amber-500/20 text-amber-300"
                                  : "bg-slate-800 text-slate-300"
                              }`}
                            >
                              {alloc.action === "ACCUMULATE" ? "BUY" : alloc.action === "TRIM" ? "TRIM" : "HOLD"}{" "}
                              {alloc.deltaBps >= 0 ? "+" : ""}
                              {(alloc.deltaBps / 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
                        <span className="text-slate-400" title="Rule score relative to the other candidates: the best one is 99, the weakest 50">
                          Score <strong className="text-cyan-400">{alloc.quantScore}</strong>
                        </span>
                        <span className="text-white font-bold">
                          {(alloc.targetWeightBps / 100).toFixed(1)}%
                          {(agentReport.cashReservePct ?? 0) > 0 ? ` of stocks (${(alloc.capitalSharePct ?? 0).toFixed(1)}% of money)` : ""} · $
                          {alloc.usdAllocation.toFixed(2)}
                        </span>
                        <span className="text-emerald-400">
                          ≈ {alloc.estimatedSharesUI.toFixed(3)} share-equivalent
                        </span>
                      </div>
                    </div>

                    <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#4C6FFF] to-cyan-400"
                        style={{ width: `${alloc.targetWeightBps / 100}%` }}
                      />
                    </div>

                    {alloc.reasons?.length ? (
                      <p className="text-[11px] text-slate-400">
                        <span className="text-slate-300">Why (rule-based opinion, not advice): </span>
                        {alloc.reasons.join(" · ")}. DEX ${alloc.dexPrice24_7.toFixed(2)} vs NAV ${alloc.navPrice.toFixed(2)}.
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-400">{alloc.rationale}</p>
                    )}
                  </div>
                ))}
              </div>
              {(agentReport.leftOut?.length ?? 0) > 0 && (
                <details className="mt-3 rounded-xl border border-slate-800 bg-[#070b14] px-3 py-2" data-testid="agent-left-out">
                  <summary className="cursor-pointer text-[11px] font-bold text-slate-300">
                    Not picked ({agentReport.leftOut!.length}) and why
                    <span className="ml-1 font-normal text-slate-500">(rule-based, not advice)</span>
                  </summary>
                  <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
                    {agentReport.leftOut!.map((l) => (
                      <li key={l.symbol}>
                        <span className="font-mono font-bold text-slate-200">{l.symbol}</span>: {l.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {(agentReport.facts?.length ?? 0) > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="agent-facts">
                <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Facts, with sources</h3>
                  <ul className="mt-2 space-y-2 text-[11px] text-slate-300">
                    {agentReport.facts.map((f) => (
                      <li key={f.symbol}>
                        <span className="font-mono font-bold text-white">{f.symbol}</span> {f.text}
                        <span className="ml-1 inline-flex flex-wrap gap-x-2">
                          {f.links.map((l) => (
                            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline hover:text-white">
                              {l.label}
                            </a>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Assumptions I made</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-slate-300">
                    {agentReport.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10px] text-slate-500">
                    The reasons on each pick above are rule-based opinions, not facts or advice.
                  </p>
                </div>
              </div>
            )}

            {studioMode && (
              <div className="rounded-xl border border-slate-800 bg-[#050811] p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Code2 className="h-4 w-4 text-[#4C6FFF]" />
                    ERC-8021 Attributed Transaction Calldata ({agentReport.onchainExecution.targetContractDescription})
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setProMode((p) => !p)}
                      className="text-slate-400 hover:text-white underline cursor-pointer"
                    >
                      {proMode ? "Hide Raw Hex" : "Inspect Raw Hex (Pro)"}
                    </button>
                    <button
                      onClick={() =>
                        copyToClipboard(agentReport.onchainExecution.attributedCalldata, "agent-calldata")
                      }
                      className="text-cyan-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="h-3 w-3" />
                      {copiedKey === "agent-calldata" ? "Copied!" : "Copy Hex"}
                    </button>
                  </div>
                </div>
                {proMode ? (
                  <>
                    <p className="font-mono text-[11px] text-slate-400 break-all leading-relaxed">
                      {agentReport.onchainExecution.rawCalldata}
                      <span className="bg-emerald-500/20 text-emerald-300 font-bold px-1 rounded">
                        {agentReport.erc8021Suffix.slice(2)}
                      </span>
                    </p>
                    <p className="text-[11px] text-emerald-400">
                      ↑ Highlighted green suffix is the official ERC-8021 Base Builder Code
                      attribution payload (`{agentReport.erc8021Suffix}`).
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-emerald-400">
                    ✓ Ready to broadcast with ERC-8021 Builder Code suffix (
                    <code className="font-mono">{agentReport.erc8021Suffix.slice(0, 22)}...</code>
                    ). Switch to <strong>Pro / Developer View</strong> to inspect full ABI hex.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
