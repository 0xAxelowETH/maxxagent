import { LiveTokenizedStock } from "./tokenizedStocks";
import { appendBuilderCodeToCalldata, toErc8021DataSuffix } from "./builderCode";
import { INDEX_REGISTRY_ABI } from "./contracts/StockMaxxIndexRegistryABI";
import { encodeFunctionData, keccak256, toHex } from "viem";
import { THEMES, parseMandate, parseMandateSteps } from "./mandate";
import { capWeightsBps, roundWeightsBps } from "./weights";
import { usMarketStatus } from "./marketHours";
import { SEC_CIK, type SecFundamentals } from "./secFundamentals";
import { UNSUPPORTED_COINBASE_STOCKS, type UnsupportedLive } from "./unsupportedStocks";
import type { RiskStats } from "./riskStats";

export interface AgentAllocationRecommendation {
  symbol: string;
  companyName: string;
  logoUrl: string;
  color: string;
  b20Address: `0x${string}`;
  chainlinkFeed: `0x${string}`;
  navPrice: number;
  dexPrice24_7: number;
  weekendGapPct: number;
  dexLiquidityUsd?: number;
  dexVolume24hUsd?: number;
  uiMultiplier: number;
  beta: number;
  currentWeightBps: number;
  targetWeightBps: number;
  deltaBps: number;
  usdAllocation: number;
  /** share of the user's money (cash reserve included) that goes into this stock */
  capitalSharePct: number;
  estimatedTokens: number;
  estimatedSharesUI: number;
  action: "ACCUMULATE" | "TRIM" | "HOLD";
  quantScore: number;
  rationale: string;
  /** short reasons this stock was picked, most important first */
  reasons: string[];
}

export interface AgentAnalysisReport {
  timestamp: string;
  strategyName: string;
  strategyTicker: string;
  userPrompt: string;
  riskProfile: "Conservative" | "Balanced" | "Aggressive";
  portfolioCapitalUsd: number;
  builderCode: string;
  erc8021Suffix: `0x${string}`;
  researchHash: `0x${string}`;
  executiveSummary: string;
  /** how the agent read the user's request (themes, exclusions, count, weighting, risk) */
  interpretation: string[];
  /** share of the money that stays in USDC (asked for, or left over to keep a weight limit) */
  cashReservePct: number;
  /** the user's per-stock limit as a share of the money, if one was given */
  maxWeightPct?: number;
  /** the same limit as a share of the stocks part (what a saved target checks the wallet against) */
  maxWeightOfStocksPct?: number;
  /** each limit in the request and what the agent did with it */
  limits: { label: string; status: "kept" | "adjusted" | "not possible"; detail: string; link?: { label: string; url: string } }[];
  /** things to check before buying (e.g. an order that is large for a stock's Base pool) */
  cautions?: string[];
  /** supported stocks that are not in the basket, and why */
  leftOut?: { symbol: string; reason: string }[];
  /** checkable numbers behind the picks, each with where to verify it */
  facts: { symbol: string; text: string; links: { label: string; url: string }[] }[];
  /** what the agent assumed because the request didn't say */
  assumptions: string[];
  marketRegimeNote: string;
  b20MultiplierInsight: string;
  allocations: AgentAllocationRecommendation[];
  /** Draft natural-language prompt the user may paste into Bankr manually (not executed by MAXXAGENT). */
  bankrDraftPrompt: string;
  onchainExecution: {
    targetContractDescription: string;
    functionName: "createIndex";
    rawCalldata: `0x${string}`;
    attributedCalldata: `0x${string}`;
  };
}

const MIN_WEIGHT_BPS = 500;
const MAX_WEIGHT_BPS = 4500;

/**
 * Converts scores into integer weights that always sum to exactly 10,000 bps,
 * each within [MIN_WEIGHT_BPS, MAX_WEIGHT_BPS] (valid input for StockMaxxIndexRegistry.createIndex).
 */
export function scoresToWeightsBps(scores: number[]): number[] {
  const n = scores.length;
  if (n === 0) return [];
  if (n === 1) return [10000];
  const min = Math.min(MIN_WEIGHT_BPS, Math.floor(10000 / n));
  const max = Math.max(MAX_WEIGHT_BPS, Math.ceil(10000 / n));
  const strength = scores.map((s) => Math.pow(Math.max(1, s - 45), 1.65));

  // Two-stage water-filling: lock ceilings first so a dominant top stock redistributes excess
  // cleanly to minor names before any minimum-weight floor locks them permanently.
  let weights = new Array(n).fill(0);
  const fixed = new Array(n).fill(false);
  for (const pass of ["max", "min"] as const) {
    for (let iter = 0; iter < n + 1; iter++) {
      const fixedTotal = weights.reduce((a, w, i) => (fixed[i] ? a + w : a), 0);
      const freeStrength = strength.reduce((a, s, i) => (fixed[i] ? a : a + s), 0);
      if (freeStrength <= 0) break;
      const remaining = 10000 - fixedTotal;
      let changed = false;
      weights = weights.map((w, i) => (fixed[i] ? w : (strength[i] / freeStrength) * remaining));
      weights.forEach((w, i) => {
        if (!fixed[i] && (pass === "max" ? w > max : w < min)) {
          weights[i] = pass === "max" ? max : min;
          fixed[i] = true;
          changed = true;
        }
      });
      if (!changed) break;
    }
  }

  // Round to 50 bps and distribute the rounding difference step-by-step within [min, max]
  const step = 50;
  const rounded = weights.map((w) => Math.min(max, Math.max(min, Math.round(w / step) * step)));
  let diff = 10000 - rounded.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, frac: w - rounded[i] }))
    .sort((a, b) => (diff > 0 ? b.frac - a.frac : a.frac - b.frac));
  let guard = 0;
  while (Math.abs(diff) >= step && guard++ < n * 20) {
    let moved = false;
    for (const { i } of order) {
      if (diff >= step && rounded[i] + step <= max) {
        rounded[i] += step;
        diff -= step;
        moved = true;
      } else if (diff <= -step && rounded[i] - step >= min) {
        rounded[i] -= step;
        diff += step;
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (diff !== 0) {
    const idx = order.find(({ i }) => rounded[i] + diff >= min && rounded[i] + diff <= max)?.i ?? rounded.indexOf(Math.max(...rounded));
    rounded[idx] += diff;
  }
  return rounded;
}

/**
 * Transparent, rule-based research-to-portfolio engine for Coinbase B20 tokenized stocks.
 * Inputs: live Chainlink total-return NAV, live DEX price (24/7) vs NAV gap, pool liquidity,
 * B20 `uiMultiplier`, static beta, and keywords from the user's mandate.
 * Output is a proposal only — the user decides and signs every transaction.
 */
export function runAutonomousStockAgent(params: {
  stocks: LiveTokenizedStock[];
  userPrompt: string;
  /** Optional multi-turn mandate steps (`[initial, followUp1, ...]`); when > 1, merged incrementally. */
  promptSteps?: string[];
  riskProfile: "Conservative" | "Balanced" | "Aggressive";
  capitalUsd: number;
  builderCode: string;
  currentWeights?: Record<string, number>;
  /** latest annual figures from each company's SEC filing, by B20 symbol (optional, server-fetched) */
  fundamentals?: Record<string, SecFundamentals | null>;
  /** live Base liquidity of unsupported Coinbase stocks the request named (optional, server-fetched) */
  unsupportedLive?: Record<string, UnsupportedLive>;
  /** live volatility and drawdown from each Chainlink feed (optional, server-computed) */
  risk?: Record<string, RiskStats | null>;
}): AgentAnalysisReport {
  const { stocks, userPrompt, promptSteps, capitalUsd, builderCode, currentWeights = {}, fundamentals = {}, unsupportedLive = {}, risk = {} } = params;
  const mandate = promptSteps && promptSteps.length > 0 ? parseMandateSteps(promptSteps) : parseMandate(userPrompt);
  const marketOpen = usMarketStatus().state === "open";
  // Words in the request ("safe", "aggressive") refine the selected profile only when it was left on Balanced
  const riskProfile = params.riskProfile === "Balanced" && mandate.riskHint ? mandate.riskHint : params.riskProfile;
  const interpretation = mandate.notes.filter((n) => !n.startsWith("Risk read"));
  if (mandate.riskHint && riskProfile === mandate.riskHint && riskProfile !== params.riskProfile)
    interpretation.push(`Risk profile: ${riskProfile.toLowerCase()}, from your words.`);
  else if (mandate.riskHint && riskProfile !== mandate.riskHint)
    interpretation.push(`Your words suggest ${mandate.riskHint.toLowerCase()}, but the selected ${riskProfile} profile was kept.`);

  const themeOf = (sym: string) => mandate.themes.filter((t) => THEMES.find((x) => x.id === t)!.symbols.includes(sym));
  // Pool: everything except exclusions; "only …" narrows it to the named themes / stocks
  // Why each supported stock that isn't in the basket was left out (first reason wins)
  const leftOut = new Map<string, string>();
  const drop = (sym: string, why: string) => {
    if (!leftOut.has(sym)) leftOut.set(sym, why);
  };
  let pool = stocks.filter((st) => !mandate.exclude.includes(st.symbol));
  for (const st of stocks) if (mandate.exclude.includes(st.symbol)) drop(st.symbol, "you asked to leave it out");
  if (mandate.only) {
    const narrowed = pool.filter((st) => mandate.include.includes(st.symbol) || themeOf(st.symbol).length > 0);
    if (narrowed.length) {
      for (const st of pool) if (!narrowed.includes(st)) drop(st.symbol, "not one of the stocks or themes you limited the basket to");
      pool = narrowed;
    } else {
      interpretation.push("None of the candidates remained after exclusions under your \"only\" filter, so all non-excluded stocks stayed eligible.");
    }
  }
  // "Profitable": leave out companies whose last 10-K shows a net loss, or that have no 10-K yet.
  // Stocks the user named stay in; figures SEC hasn't returned yet are not held against a stock.
  const big = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n) >= 1e9 ? `${(Math.abs(n) / 1e9).toFixed(1)}B` : `${(Math.abs(n) / 1e6).toFixed(0)}M`}`;
  const fyLabel = (end: string) => new Date(`${end}T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const profitLimit: AgentAnalysisReport["limits"] = [];
  if (mandate.prefersProfitable) {
    const dropped: string[] = [];
    let pendingCount = 0;
    let missingProfitCount = 0;
    const kept = pool.filter((st) => {
      if (mandate.include.includes(st.symbol)) return true;
      const f = fundamentals[st.symbol];
      if (f === undefined) {
        pendingCount++;
        return true;
      }
      if (f !== null && f.netIncomeUsd === null) {
        missingProfitCount++;
        return true;
      }
      if (f === null) {
        dropped.push(`${st.symbol} (no annual report filed with the SEC yet)`);
        return false;
      }
      if ((f.netIncomeUsd ?? 0) < 0) {
        dropped.push(`${st.symbol} (net loss ${big(Math.abs(f.netIncomeUsd!))} in the fiscal year to ${fyLabel(f.periodEnd)})`);
        return false;
      }
      return true;
    });
    if (kept.length) {
      for (const st of pool) {
        if (kept.includes(st)) continue;
        const f = fundamentals[st.symbol];
        drop(st.symbol, f ? `net loss ${big(Math.abs(f.netIncomeUsd!))} in its last 10-K, and you asked for profitable companies` : "no annual report (10-K) with the SEC yet, so its profit can't be checked");
      }
      pool = kept;
      const unknownNotes = [
        pendingCount ? `${pendingCount} stock${pendingCount > 1 ? "s" : ""} couldn't be checked right now (SEC data still loading)` : "",
        missingProfitCount ? `${missingProfitCount} stock${missingProfitCount > 1 ? "s" : ""} lacked a NetIncomeLoss line in the 10-K summary` : "",
      ].filter(Boolean);
      profitLimit.push({
        label: "Profitable companies only",
        status: unknownNotes.length ? "adjusted" : "kept",
        detail:
          (dropped.length ? `Left out ${dropped.join(", ")}, from their SEC filings.` : "Every candidate reported a profit in its last 10-K.") +
          (unknownNotes.length ? ` ${unknownNotes.join("; ")}, so kept eligible.` : ""),
      });
    } else {
      profitLimit.push({
        label: "Profitable companies only",
        status: "adjusted",
        detail: "None of the matching stocks met the profitability check (or reported a 10-K profit yet), so the profitable filter was skipped.",
      });
    }
  }
  const riskComplete = pool.every((st) => risk[st.symbol]);
  // A conservative basket leaves out the wildest stocks (over 60% a year on live Chainlink history), unless named
  if (riskProfile === "Conservative" && riskComplete) {
    const wild = pool.filter((st) => !mandate.include.includes(st.symbol) && (risk[st.symbol]?.volPct ?? 0) > 60);
    if (wild.length && pool.length - wild.length >= 2) {
      for (const st of wild) drop(st.symbol, `volatility ${risk[st.symbol]!.volPct.toFixed(0)}% a year, above 60% for a conservative basket`);
      pool = pool.filter((st) => !wild.includes(st));
      interpretation.push(
        `For a conservative basket I left out ${wild.map((st) => `${st.symbol} (${risk[st.symbol]!.volPct.toFixed(0)}% a year)`).join(", ")}: volatility above 60% a year on recent Chainlink NAV.`
      );
    }
  }
  if (pool.length === 0) {
    pool = stocks;
    leftOut.clear();
    interpretation.push("Every stock was excluded, so the exclusions were ignored.");
  }

  const scored = pool.map((stock) => {
    let score = stock.aiScoreBase;
    const reasons: string[] = [];
    const themes = themeOf(stock.symbol);

    // 1. Mandate
    if (mandate.include.includes(stock.symbol)) {
      score += 35;
      reasons.push("you asked for it");
    }
    if (themes.length) {
      score += Math.min(30, 18 * themes.length);
      reasons.push(`fits your ${themes.map((t) => THEMES.find((x) => x.id === t)!.label).join(" + ")} theme`);
    }
    if (mandate.prefersDiscount && stock.weekendGapPct < 0) score += Math.min(25, Math.abs(stock.weekendGapPct) * 35);
    if (mandate.prefersDividends && stock.uiMultiplier > 1.0001) score += 12;
    if (mandate.prefersLiquidity) score += Math.min(12, ((stock.dexLiquidityUsd ?? 0) / 1_000_000) * 8);
    // Fundamentals from the company's last 10-K, only when the request asks for them
    const fund = fundamentals[stock.symbol];
    if (mandate.prefersGrowth && fund && fund.revenueGrowthPct !== null) {
      const g = fund.revenueGrowthPct;
      score += Math.max(-8, Math.min(20, g * 0.25));
      reasons.push(`revenue ${g >= 0 ? "+" : ""}${g.toFixed(0)}% in its last fiscal year (SEC 10-K)`);
    }
    if (mandate.prefersProfitable && fund && fund.netIncomeUsd !== null && fund.netIncomeUsd > 0) {
      score += Math.min(10, (fund.netIncomeUsd / Math.max(1, fund.revenueUsd)) * 30);
      reasons.push(`profitable: net income ${big(fund.netIncomeUsd)}, ${((fund.netIncomeUsd / Math.max(1, fund.revenueUsd)) * 100).toFixed(0)}% of revenue (SEC 10-K)`);
    }

    // 2. Live market factors
    // A: DEX trading below Chainlink NAV (cheaper entry), penalise premiums
    if (stock.weekendGapPct < -0.05) {
      score += Math.min(8, Math.abs(stock.weekendGapPct) * 12);
      reasons.push(`${Math.abs(stock.weekendGapPct).toFixed(2)}% below NAV on DEX (cheaper entry)`);
    } else if (stock.weekendGapPct > 0.5) {
      score -= Math.min(6, stock.weekendGapPct * 4);
      reasons.push(`${stock.weekendGapPct.toFixed(2)}% above NAV on DEX (premium)`);
    }
    // B: reinvested dividends reflected in the multiplier
    if (stock.uiMultiplier > 1.0001) {
      score += 4;
      reasons.push(`dividends reinvested (multiplier ${stock.uiMultiplier.toFixed(4)}x)`);
    }
    // C: liquidity depth (execution quality); unknown liquidity stays neutral
    if (typeof stock.dexLiquidityUsd === "number") {
      const liq = stock.dexLiquidityUsd;
      if (liq > 500_000) {
        score += 5;
        reasons.push(`deep liquidity ($${(liq / 1e6).toFixed(1)}M)`);
      } else if (liq > 200_000) score += 3;
      else if (liq < 50_000) {
        score -= 6;
        reasons.push(`thin liquidity ($${(liq / 1e3).toFixed(0)}K): higher swap cost`);
      }
    }

    // 3. Risk profile vs live volatility (Chainlink NAV, ~2 months); the fixed beta estimate only as a fallback.
    // Volatility / 30 puts both on the same scale (25%/yr ~ 0.8, 50%/yr ~ 1.7, 80%/yr ~ 2.7).
    // One scale for every candidate: live volatility only once every stock has it, otherwise the beta estimate
    const rs = riskComplete ? risk[stock.symbol] : null;
    const level = rs ? rs.volPct / 30 : stock.beta;
    const riskText = rs ? `${rs.volPct.toFixed(0)}% a year over the last ${rs.days} trading days, Chainlink NAV` : `estimated beta ${stock.beta.toFixed(2)}`;
    if (riskProfile === "Conservative") {
      // Strong enough that a "safe" request really favours the calmest stocks (AAPLc/MSFTc over SPCXc/SNDKc)
      score += (2.2 - level) * 24;
      if (level <= 1.3) reasons.push(`lower volatility (${riskText}) for a conservative profile`);
    } else if (riskProfile === "Aggressive") {
      score += (level - 1.0) * 16;
      if (level >= 1.6) reasons.push(`higher volatility (${riskText}) for an aggressive profile`);
    } else score += 10 - Math.abs(1.45 - level) * 8;

    // 4. Stale oracle penalty. Over a weekend or holiday the NAV is simply the last close (Chainlink stops
    // updating stock feeds when the market is shut), so that is not "stale" and costs no points.
    const closedGap = !marketOpen && stock.oracleAgeMinutes > 0 && stock.oracleAgeMinutes < 80 * 60;
    if (stock.isOracleStale && !closedGap) {
      score -= 8;
      reasons.push("NAV oracle is stale");
    }

    // rawScore drives ranking & weights (uncapped, so strong preferences stay distinguishable);
    // quantScore is the capped 55–99 display value.
    return { stock, rawScore: score, quantScore: Math.min(99, Math.max(55, Math.round(score))), reasons };
  });

  scored.sort((a, b) => b.rawScore - a.rawScore);
  // Display score relative to the candidates (best 99, weakest 50): raw scores usually exceed 99, so a
  // capped value showed "99/99" for every pick and told the user nothing
  if (scored.length > 1) {
    const hi = scored[0].rawScore;
    const lo = scored[scored.length - 1].rawScore;
    for (const x of scored) x.quantScore = Math.round(50 + (49 * (x.rawScore - lo)) / (hi - lo || 1));
  } else if (scored.length === 1) scored[0].quantScore = 99;
  // Limits: cash reserve and per-stock maximum, both as a share of the money
  const askedCashPct = mandate.cashPct ?? 0;
  const capPct = mandate.maxWeightPct;
  let investPct = 100 - askedCashPct;
  // Named stocks always make it in; the rest is filled by score. A weight limit needs enough stocks to stay
  // under it, so without an explicit count the basket grows to fit the limit
  let wantedBase = Math.max(mandate.count ?? 5, mandate.count ? 0 : mandate.include.length);
  if (capPct && !mandate.count) wantedBase = Math.max(wantedBase, Math.ceil(investPct / capPct - 1e-9));
  const wanted = Math.min(pool.length, wantedBase);
  const named = scored.filter((x) => mandate.include.includes(x.stock.symbol));
  const others = scored.filter((x) => !mandate.include.includes(x.stock.symbol));
  let selected = [...named, ...others].slice(0, Math.max(1, wanted)).sort((a, b) => b.rawScore - a.rawScore);
  if (mandate.count && named.length > wanted) {
    interpretation.push(`You asked for ${wanted} stocks, so only the ${wanted} highest-scoring named stocks were kept.`);
  }
  // Weights the user set ("60% Apple 40% Microsoft") are shares of the money; convert to shares of the
  // invested part (after any cash reserve, and after a weight limit that leaves money in USDC). When they
  // already fill it, the basket is just those stocks; a remainder too small to spread (<5% per stock) is
  // spread over fewer stocks, or none.
  const fixedSyms = Object.keys(mandate.weightsPct).filter((s) => selected.some((x) => x.stock.symbol === s));
  const cappedFixedPct = (s: string) => (capPct ? Math.min(mandate.weightsPct[s], capPct) : mandate.weightsPct[s]);
  const investedFor = (sel: typeof selected) => {
    if (!capPct) return investPct;
    const fMoney = sel.reduce((a, x) => (fixedSyms.includes(x.stock.symbol) ? a + cappedFixedPct(x.stock.symbol) : a), 0);
    const rCount = sel.filter((x) => !fixedSyms.includes(x.stock.symbol)).length;
    const capRoom = fixedSyms.length ? fMoney + rCount * capPct : sel.length * capPct;
    return capRoom < investPct - 1e-9 ? capRoom : investPct;
  };
  let fixedBase = investedFor(selected);
  const fixedOfStocks = (s: string) => (fixedBase > 0 ? (cappedFixedPct(s) / fixedBase) * 100 : 0);
  let fixedSum = fixedSyms.reduce((a, s) => a + fixedOfStocks(s), 0);
  if (fixedSyms.length) {
    const restIdx = selected.filter((x) => !fixedSyms.includes(x.stock.symbol));
    const fits = fixedSum >= 99.5 ? 0 : Math.min(restIdx.length, Math.floor((100 - fixedSum) / 5));
    const keepRest = new Set(restIdx.slice(0, fits));
    selected = selected.filter((x) => fixedSyms.includes(x.stock.symbol) || keepRest.has(x));
    fixedBase = investedFor(selected);
    fixedSum = fixedSyms.reduce((a, s) => a + fixedOfStocks(s), 0);
    // Recompute check: if shrinking selected made fixedSum >= 99.5, drop remaining non-fixed stocks so restPct is never negative
    if (fixedSum >= 99.5 && selected.some((x) => !fixedSyms.includes(x.stock.symbol))) {
      selected = selected.filter((x) => fixedSyms.includes(x.stock.symbol));
      fixedBase = investedFor(selected);
      fixedSum = fixedSyms.reduce((a, s) => a + fixedOfStocks(s), 0);
    }
  }
  // A stock the user named but that has no room because their set weights already fill the basket: say so,
  // instead of the "always included" note quietly being wrong
  const namedNoRoom = mandate.include.filter((s) => !fixedSyms.includes(s) && !selected.some((x) => x.stock.symbol === s) && scored.some((x) => x.stock.symbol === s));
  if (namedNoRoom.length && fixedSum >= 99.5) {
    const namedIdx = interpretation.findIndex((n) => n.startsWith("You named "));
    const stillIn = mandate.include.filter((s) => !namedNoRoom.includes(s));
    if (namedIdx >= 0)
      if (stillIn.length) interpretation[namedIdx] = `You named ${stillIn.join(", ")}: always included.`;
      else interpretation.splice(namedIdx, 1);
    interpretation.push(
      `${namedNoRoom.join(", ")} left out: the weights you set (${fixedSyms.map((s) => `${s} ${mandate.weightsPct[s]}%`).join(", ")}) already fill the basket. Lower one of them to make room, e.g. "${fixedSyms[0]} ${Math.max(5, Math.round(mandate.weightsPct[fixedSyms[0]] / 2))}%".`
    );
  }
  const added = selected.filter((x) => !mandate.include.includes(x.stock.symbol) && !themeOf(x.stock.symbol).length).length;
  if (added > 0 && (mandate.include.length || mandate.themes.length) && !mandate.only)
    interpretation.push(`Added ${added} more by score to diversify (say "only" to keep just what you named).`);
  if (mandate.count && mandate.count > selected.length && !fixedSyms.length) {
    interpretation.push(`Only ${pool.length} stock${pool.length > 1 ? "s" : ""} match, so the basket has ${pool.length}.`);
  }
  let weights: number[];
  const fixedLimits: AgentAnalysisReport["limits"] = [];
  const limits: AgentAnalysisReport["limits"] = [];
  let maxWeightOfStocksPct: number | undefined;
  if (capPct) {
    const n = selected.length;
    if (fixedBase < investPct - 1e-9) {
      const kept = 100 - fixedBase;
      limits.push({
        label: `Max ${capPct}% per stock`,
        status: "kept",
        detail: `${n} stock${n > 1 ? "s" : ""} under your limits can hold only ${fixedBase.toFixed(0)}% of your money, so I kept the limit and ${(kept - askedCashPct).toFixed(0)}% more stays in USDC.`,
      });
      investPct = fixedBase;
    }
  }
  if (fixedSyms.length) {
    const rest = selected.filter((x) => !fixedSyms.includes(x.stock.symbol));
    const setText = fixedSyms.map((s) => `${s} ${mandate.weightsPct[s]}%`).join(", ");
    const overLimit = fixedSyms.some((s) => capPct && mandate.weightsPct[s] > capPct);
    const allCapBps = capPct ? Math.max(Math.floor((capPct / investPct) * 10000), Math.ceil(10000 / selected.length)) : 10000;
    if (!rest.length) {
      const rawFixed = selected.map((x) => fixedOfStocks(x.stock.symbol));
      weights = roundWeightsBps(rawFixed, allCapBps) ?? roundWeightsBps(rawFixed)!;
      // Talk in the user's own numbers (share of their money), not the internal share of the invested part
      const userSum = fixedSyms.reduce((a, s) => a + mandate.weightsPct[s], 0);
      if (Math.abs(userSum - fixedBase) > 0.5 && !overLimit)
        fixedLimits.push({
          label: "Your weights",
          status: "adjusted",
          detail: `${setText} add up to ${userSum.toFixed(0)}% of your money, so they were scaled to ${fixedBase.toFixed(0)}% in the same proportions${userSum < fixedBase ? " (the rest was too small to spread over more stocks)" : ""}.`,
        });
      // When the per-stock limit is what changed them, "Your weights vs your limit" below says so; no second card
      else if (!overLimit) fixedLimits.push({ label: "Your weights", status: "kept", detail: `${setText}, as you set them.` });
    } else {
      const floor = Math.min(...rest.map((x) => x.rawScore)) - 20;
      let restShares = scoresToWeightsBps(rest.map((x) => x.rawScore - floor + 45));
      const restPct = Math.max(0, 100 - fixedSum);
      if (capPct && restPct > 0) {
        const restCapBps = Math.max(Math.floor(((capPct / investPct) * 1_000_000) / restPct), Math.ceil(10000 / rest.length));
        restShares = capWeightsBps(restShares, restCapBps) ?? restShares;
      }
      const raw = selected.map((x) => (fixedSyms.includes(x.stock.symbol) ? fixedOfStocks(x.stock.symbol) : (restShares[rest.indexOf(x)] / 10000) * restPct));
      weights = roundWeightsBps(raw, allCapBps) ?? roundWeightsBps(raw)!;
      if (!overLimit) {
        fixedLimits.push({
          label: "Your weights",
          status: "kept",
          detail: `${setText}, as you set them. The other ${((restPct * fixedBase) / 100).toFixed(0)}% of your money is spread by score across ${rest.map((x) => x.stock.symbol).join(", ")}.`,
        });
      }
    }
    const over = fixedSyms.filter((s) => mandate.maxWeightPct && mandate.weightsPct[s] > mandate.maxWeightPct);
    if (over.length)
      fixedLimits.push({
        label: "Your weights vs your limit",
        status: "adjusted",
        detail: `${over.map((s) => `${s} ${mandate.weightsPct[s]}%`).join(", ")} ${over.length > 1 ? "are" : "is"} above your ${mandate.maxWeightPct}% limit, so the limit wins.`,
      });
  } else if (mandate.equalWeight) {
    const base = Math.floor(10000 / selected.length / 50) * 50;
    weights = selected.map(() => base);
    let rem = 10000 - base * selected.length;
    for (let i = 0; rem >= 50; i++) {
      weights[i % weights.length] += 50;
      rem -= 50;
    }
    weights[0] += rem;
  } else {
    // Weight strength relative to the weakest selected stock keeps weights differentiated
    const floor = Math.min(...selected.map((x) => x.rawScore)) - 20;
    weights = scoresToWeightsBps(selected.map((x) => x.rawScore - floor + 45));
  }

  // The weight limit is never broken. When the stocks can't hold all the money under it, the rest stays
  // in USDC instead (e.g. 3 stocks x max 30% = 90% invested, 10% kept)
  if (capPct) {
    const n = selected.length;
    const capOfStocks = (capPct / investPct) * 10000;
    const capBps = Math.max(capOfStocks, Math.ceil(10000 / n));
    if (!fixedSyms.length) weights = capWeightsBps(weights, capBps) ?? weights;
    // Rounding to whole bps can leave the largest leg a hair over the limit (3 x max 30%: 3334 bps of 90% = 30.01%).
    // Keep that hair in USDC instead, so the limit holds exactly.
    const topBps = Math.max(...weights);
    if (topBps > 0 && (topBps / 10000) * investPct > capPct + 1e-9) investPct = Math.floor(((capPct * 10000) / topBps) * 100) / 100;
    maxWeightOfStocksPct = Math.round((capPct / investPct) * 10000) / 100;
    if (!limits.length) {
      const top = Math.max(...weights) * (investPct / 10000);
      limits.push({ label: `Max ${capPct}% per stock`, status: "kept", detail: `The largest position is ${top.toFixed(1)}% of your money.` });
    }
  }
  // Never propose a 0% leg: the index registry rejects zero weights and a $0 swap makes no sense
  if (weights.some((w) => w <= 0)) {
    const keep = weights.map((w) => w > 0);
    selected = selected.filter((_, i) => keep[i]);
    weights = weights.filter((w) => w > 0);
  }
  // Candidates that scored but didn't make it in: say whether the user's weights, the basket size or the
  // rule score kept them out, with the weakest factor when there is one
  scored.forEach((x, rank) => {
    if (selected.includes(x)) return;
    const weak = x.reasons.find((r) => /thin liquidity|above NAV|stale/.test(r));
    if (fixedSyms.length && fixedSum >= 99.5) drop(x.stock.symbol, "the weights you set already fill the basket");
    else
      drop(
        x.stock.symbol,
        `ranked ${rank + 1} of ${scored.length} by rule score, below the ${selected.length} picks${weak ? ` (${weak})` : ""}`
      );
  });
  if (askedCashPct) limits.push({ label: `Keep ${askedCashPct}% in USDC`, status: "kept", detail: `${askedCashPct}% of the amount is not invested.` });
  for (const sym of mandate.exclude) {
    if (stocks.some((st) => st.symbol === sym) && pool.every((p) => p.symbol !== sym))
      limits.push({ label: `No ${sym}`, status: "kept", detail: "Left out of the basket." });
  }
  if (mandate.count && selected.length < mandate.count)
    limits.push({ label: `${mandate.count} stocks`, status: "adjusted", detail: `Only ${selected.length} match the rest of your request.` });
  limits.push(...fixedLimits, ...profitLimit);
  // Not supported: say plainly whether Coinbase issues it on Base, and why MAXXAGENT leaves it out
  const closest = (u: { closest?: string }) => (u.closest ? ` Closest supported: ${u.closest}.` : "");
  for (const u of mandate.unavailable) {
    if (u.sector) {
      limits.push({ label: u.name, status: "not possible", detail: "None of the 10 stocks MAXXAGENT supports is in this group." });
      continue;
    }
    const meta = u.token ? UNSUPPORTED_COINBASE_STOCKS[u.token] : undefined;
    if (!u.token || !meta) {
      limits.push({ label: u.name, status: "not possible", detail: `Coinbase doesn't issue ${u.name} as a tokenized stock on Base.${closest(u)}` });
      continue;
    }
    const live = unsupportedLive[u.token];
    const why: string[] = [];
    if (live?.liquidityUsd != null)
      why.push(live.liquidityUsd < 1000 ? "it has no real pool on Base" : `its Base pools hold only about $${live.liquidityUsd >= 1e6 ? `${(live.liquidityUsd / 1e6).toFixed(1)}M` : `${Math.round(live.liquidityUsd / 1e3)}K`}`);
    if (!meta.chainlink) why.push("Chainlink publishes no price for it on Base, so the NAV safety check can't run");
    limits.push({
      label: u.name,
      status: "not possible",
      detail: `${u.token} is a Coinbase tokenized stock on Base, but MAXXAGENT doesn't support it${why.length ? `: ${why.join(", and ")}` : " yet"}. MAXXAGENT trades only 10 stocks with deep liquidity and a Chainlink price.${closest(u)}`,
      link: live?.poolUrl ? { label: "Pool", url: live.poolUrl } : { label: "Token", url: `https://basescan.org/token/${meta.address}` },
    });
  }
  if (mandate.unavailable.length && !mandate.include.length && !mandate.themes.length)
    interpretation.push("Nothing you asked for is among the 10 stocks MAXXAGENT supports, so this basket is built from all 10 by score.");
  const cashReservePct = Math.round((100 - investPct) * 100) / 100;

  const allocations: AgentAllocationRecommendation[] = selected.map((item, idx) => {
    const s = item.stock;
    const targetWeightBps = weights[idx];
    const currentWeightBps = currentWeights[s.symbol] ?? 0;
    const deltaBps = targetWeightBps - currentWeightBps;
    const usdAllocation = (capitalUsd * (investPct / 100) * targetWeightBps) / 10000;
    const capitalSharePct = (targetWeightBps / 100) * (investPct / 100);
    // Chainlink NAV is the per-token (multiplier-adjusted) value
    const estimatedTokens = s.navPrice > 0 ? usdAllocation / s.navPrice : 0;
    const estimatedSharesUI = estimatedTokens * s.uiMultiplier;

    let action: "ACCUMULATE" | "TRIM" | "HOLD" = "HOLD";
    if (deltaBps >= 150) action = "ACCUMULATE";
    else if (deltaBps <= -150) action = "TRIM";

    const reasons = item.reasons.length ? item.reasons : ["strong overall rule score"];
    const priceNote = `DEX $${s.dexPrice24_7.toFixed(2)} vs NAV $${s.navPrice.toFixed(2)}`;

    return {
      symbol: s.symbol,
      companyName: s.companyName,
      logoUrl: s.logoUrl,
      color: s.color,
      b20Address: s.b20Address,
      chainlinkFeed: s.chainlinkFeed,
      navPrice: s.navPrice,
      dexPrice24_7: s.dexPrice24_7,
      weekendGapPct: s.weekendGapPct,
      dexLiquidityUsd: s.dexLiquidityUsd,
      dexVolume24hUsd: s.dexVolume24hUsd,
      uiMultiplier: s.uiMultiplier,
      beta: s.beta,
      currentWeightBps,
      targetWeightBps,
      deltaBps,
      usdAllocation,
      capitalSharePct,
      estimatedTokens,
      estimatedSharesUI,
      action,
      quantScore: item.quantScore,
      reasons,
      rationale: `${s.companyName} (${s.symbol}): ${reasons.join("; ")}. ${priceNote}. Rule score ${item.quantScore}/99.`,
    };
  });

  // Shares of the money, like the donut and the allocation rows (not of the invested part), plus the USDC kept
  const topTickers =
    allocations.map((a) => `${a.symbol} ${a.capitalSharePct.toFixed(1)}%`).join(", ") +
    (cashReservePct > 0 ? `, ${cashReservePct.toFixed(cashReservePct % 1 ? 1 : 0)}% kept in USDC` : "");
  const NAMES: Record<string, [string, string]> = {
    ai: ["MAXX AI Basket", "MAXX-AI"],
    chips: ["MAXX Chips Basket", "MAXX-CHIP"],
    cloud: ["MAXX Cloud Basket", "MAXX-CLOUD"],
    bigtech: ["MAXX Big Tech Basket", "MAXX-MEGA"],
    consumer: ["MAXX Consumer Basket", "MAXX-CONS"],
    social: ["MAXX Social & Ads Basket", "MAXX-ADS"],
    ev: ["MAXX EV & Robotics Basket", "MAXX-EV"],
    space: ["MAXX Space Basket", "MAXX-SPACE"],
    crypto: ["MAXX Bitcoin Proxy Basket", "MAXX-BTC"],
    storage: ["MAXX Storage Basket", "MAXX-MEM"],
    frontier: ["MAXX Frontier Basket", "MAXX-FRNT"],
  };
  const [strategyName, strategyTicker] =
    NAMES[mandate.themes[0]] ?? (riskProfile === "Conservative" ? ["MAXX Fortress Basket", "MAXX-SAFE"] : ["MAXX Agentic Stock Basket", "MAXX-MIX"]);

  // Facts: the live numbers behind each pick, each with a place to check it
  const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const age = (m: number) => (m < 0 ? "" : m < 60 ? `, updated ${Math.round(m)} min ago` : m < 2880 ? `, updated ${Math.round(m / 60)} h ago` : `, updated ${Math.round(m / 1440)} days ago`);
  const facts: AgentAnalysisReport["facts"] = selected.map(({ stock: s }) => {
    const parts = [`NAV ${fmt(s.navPrice)} (Chainlink${age(s.oracleAgeMinutes ?? -1)})`];
    const links = [{ label: "Chainlink feed", url: `https://basescan.org/address/${s.chainlinkFeed}` }];
    if (s.dexPairAddress && /^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(s.dexPairAddress)) {
      parts.push(`DEX ${fmt(s.dexPrice24_7)}, ${s.weekendGapPct >= 0 ? "+" : ""}${s.weekendGapPct.toFixed(2)}% vs NAV`);
      if (s.dexLiquidityUsd) parts.push(`pool liquidity ${s.dexLiquidityUsd >= 1e6 ? `$${(s.dexLiquidityUsd / 1e6).toFixed(1)}M` : `$${Math.round(s.dexLiquidityUsd / 1e3)}K`}`);
      links.push({ label: "DEX pool", url: `https://dexscreener.com/base/${s.dexPairAddress}` });
    } else parts.push("no live DEX quote, NAV used");
    if (s.uiMultiplier > 1.0001) parts.push(`multiplier ${s.uiMultiplier.toFixed(4)}x`);
    const r = risk[s.symbol];
    if (r) parts.push(`volatility ${r.volPct.toFixed(0)}% a year, largest fall ${r.maxDrawdownPct.toFixed(0)}% (${r.days} trading days of Chainlink NAV since ${r.from})`);
    links.push({ label: "Token", url: `https://basescan.org/token/${s.b20Address}` });
    const f = fundamentals[s.symbol];
    if (f) {
      const big = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n) >= 1e9 ? `${(Math.abs(n) / 1e9).toFixed(1)}B` : `${(Math.abs(n) / 1e6).toFixed(0)}M`}`;
      const fy = new Date(`${f.periodEnd}T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
      let t = `company revenue ${big(f.revenueUsd)} in the fiscal year to ${fy}`;
      if (f.revenueGrowthPct !== null) t += ` (${f.revenueGrowthPct >= 0 ? "+" : ""}${f.revenueGrowthPct.toFixed(0)}% vs the year before)`;
      if (f.netIncomeUsd !== null) t += `, net income ${big(f.netIncomeUsd)}`;
      parts.push(`${t} (${f.form} filed ${f.filed})`);
      links.push({ label: `SEC ${f.form}`, url: f.filingUrl });
    } else if (f === null && SEC_CIK[s.symbol]) {
      parts.push("no annual report (10-K) filed with the SEC yet");
      links.push({ label: "SEC filings", url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${SEC_CIK[s.symbol]}` });
    }
    if (s.prospectusUrl) links.push({ label: "Token prospectus", url: s.prospectusUrl });
    return { symbol: s.symbol, text: parts.join(" · "), links };
  });

  // Assumptions: what the request didn't say, so the agent chose
  const assumptions: string[] = [];
  if (!mandate.count) assumptions.push(`No number of stocks given: I picked ${selected.length}${capPct ? " (enough to stay under your limit)" : ""}.`);
  assumptions.push(
    fixedSyms.length
      ? `Weights you set are used for ${fixedSyms.join(", ")}${selected.length > fixedSyms.length ? "; the others follow each stock's rule score" : ""}.`
      : mandate.equalWeight
      ? "Equal weights, as you asked."
      : "No weights given: they follow each stock's rule score."
  );
  assumptions.push(
    `Risk profile: ${riskProfile.toLowerCase()}${riskProfile === params.riskProfile ? " (the selected setting)" : " (from your words)"}. ` +
      (riskComplete
        ? "Risk is measured from each stock's last ~2 months of Chainlink NAV. Past volatility doesn't predict the future."
        : "Live risk history is still loading, so fixed beta estimates were used for every stock this time.")
  );
  if (usMarketStatus().state !== "open") assumptions.push("The US market is closed: NAV is the last close, and DEX prices can drift from it until the next open.");
  assumptions.push("Prices are from now. The exact amount is quoted again in the review, before you sign.");

  // Order size vs pool depth: a leg above 2% of a stock's Base liquidity can move its price
  const cautions: string[] = [];
  for (const a of allocations) {
    const liq = a.dexLiquidityUsd ?? 0;
    if (liq > 0 && a.usdAllocation > liq * 0.02)
      cautions.push(
        `${a.symbol}: $${a.usdAllocation.toFixed(0)} is ${((a.usdAllocation / liq) * 100).toFixed(1)}% of its Base pool liquidity ($${liq >= 1e6 ? `${(liq / 1e6).toFixed(1)}M` : `${Math.round(liq / 1e3)}K`}), so the price can move. The review shows the exact cost before you sign, and routes costing over 1.5% are skipped.`
      );
  }

  const executiveSummary = `Proposed ${riskProfile.toLowerCase()} basket from live Chainlink NAV, DEX prices, liquidity and B20 multipliers across the 10 stocks MAXXAGENT supports: ${topTickers}. Not financial advice — review before buying.`;

  const researchHash = keccak256(
    toHex(`${strategyName}|${topTickers}|${new Date().toISOString().slice(0, 13)}`)
  );
  const { dataSuffix } = toErc8021DataSuffix([builderCode]);

  const rawCalldata = encodeFunctionData({
    abi: INDEX_REGISTRY_ABI,
    functionName: "createIndex",
    args: [
      strategyName,
      strategyTicker,
      allocations.map((a) => a.b20Address),
      allocations.map((a) => a.targetWeightBps),
    ],
  });

  const bankrDraftPrompt = `Buy on Base with USDC: ${allocations
    .map((a) => `$${a.usdAllocation.toFixed(2)} of ${a.symbol} (${a.b20Address})`)
    .join(", ")}`;

  return {
    timestamp: new Date().toISOString(),
    strategyName,
    strategyTicker,
    userPrompt,
    riskProfile,
    portfolioCapitalUsd: capitalUsd,
    builderCode,
    erc8021Suffix: dataSuffix,
    researchHash,
    executiveSummary,
    interpretation,
    cashReservePct,
    maxWeightPct: capPct,
    maxWeightOfStocksPct,
    limits,
    // Filter reasons first (in the order they were applied), then the rest by rank
    leftOut: [...leftOut.entries()].filter(([sym]) => !selected.some((x) => x.stock.symbol === sym)).map(([symbol, reason]) => ({ symbol, reason })),
    cautions,
    facts,
    assumptions,
    marketRegimeNote:
      "Chainlink total-return feeds update 24/5 (frozen on weekends/holidays); DEX pools trade 24/7. Stale feeds are penalised.",
    b20MultiplierInsight:
      "Dividends and splits are reflected through the B20 uiMultiplier: token balances stay constant while share-equivalent balances (balanceOfUI) change.",
    allocations,
    bankrDraftPrompt,
    onchainExecution: {
      targetContractDescription: "StockMaxxIndexRegistry.createIndex",
      functionName: "createIndex",
      rawCalldata,
      attributedCalldata: appendBuilderCodeToCalldata(rawCalldata, builderCode),
    },
  };
}
