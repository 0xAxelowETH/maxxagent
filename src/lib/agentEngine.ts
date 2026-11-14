import { LiveTokenizedStock } from "./tokenizedStocks";
import { appendBuilderCodeToCalldata, toErc8021DataSuffix } from "./builderCode";
import { INDEX_REGISTRY_ABI } from "./contracts/StockMaxxIndexRegistryABI";
import { encodeFunctionData, keccak256, toHex } from "viem";
import { THEMES, parseMandate } from "./mandate";
import { capWeightsBps } from "./weights";
import { usMarketStatus } from "./marketHours";

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
  limits: { label: string; status: "kept" | "adjusted" | "not possible"; detail: string }[];
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

  // Iteratively clamp to [min, max] while keeping the total at 10,000
  let weights = new Array(n).fill(0);
  const fixed = new Array(n).fill(false);
  for (let iter = 0; iter < n + 1; iter++) {
    const fixedTotal = weights.reduce((a, w, i) => (fixed[i] ? a + w : a), 0);
    const freeStrength = strength.reduce((a, s, i) => (fixed[i] ? a : a + s), 0);
    const remaining = 10000 - fixedTotal;
    let changed = false;
    weights = weights.map((w, i) => (fixed[i] ? w : (strength[i] / freeStrength) * remaining));
    weights.forEach((w, i) => {
      if (fixed[i]) return;
      if (w < min) {
        weights[i] = min;
        fixed[i] = true;
        changed = true;
      } else if (w > max) {
        weights[i] = max;
        fixed[i] = true;
        changed = true;
      }
    });
    if (!changed) break;
  }

  // Round to 50 bps and push the rounding difference onto the largest weight
  const rounded = weights.map((w) => Math.round(w / 50) * 50);
  const diff = 10000 - rounded.reduce((a, b) => a + b, 0);
  const largest = rounded.indexOf(Math.max(...rounded));
  rounded[largest] += diff;
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
  riskProfile: "Conservative" | "Balanced" | "Aggressive";
  capitalUsd: number;
  builderCode: string;
  currentWeights?: Record<string, number>;
}): AgentAnalysisReport {
  const { stocks, userPrompt, capitalUsd, builderCode, currentWeights = {} } = params;
  const mandate = parseMandate(userPrompt);
  // Words in the request ("safe", "aggressive") refine the selected profile only when it was left on Balanced
  const riskProfile = params.riskProfile === "Balanced" && mandate.riskHint ? mandate.riskHint : params.riskProfile;
  const interpretation = mandate.notes.filter((n) => !n.startsWith("Risk read"));
  if (mandate.riskHint && riskProfile === mandate.riskHint && riskProfile !== params.riskProfile)
    interpretation.push(`Risk profile: ${riskProfile.toLowerCase()}, from your words.`);
  else if (mandate.riskHint && riskProfile !== mandate.riskHint)
    interpretation.push(`Your words suggest ${mandate.riskHint.toLowerCase()}, but the selected ${riskProfile} profile was kept.`);

  const themeOf = (sym: string) => mandate.themes.filter((t) => THEMES.find((x) => x.id === t)!.symbols.includes(sym));
  // Pool: everything except exclusions; "only …" narrows it to the named themes / stocks
  let pool = stocks.filter((st) => !mandate.exclude.includes(st.symbol));
  if (mandate.only) {
    const narrowed = pool.filter((st) => mandate.include.includes(st.symbol) || themeOf(st.symbol).length > 0);
    if (narrowed.length) pool = narrowed;
  }
  if (pool.length === 0) {
    pool = stocks;
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
    // C: liquidity depth (execution quality); unknown liquidity gets no bonus
    const liq = stock.dexLiquidityUsd ?? 0;
    if (liq > 500_000) {
      score += 5;
      reasons.push(`deep liquidity ($${(liq / 1e6).toFixed(1)}M)`);
    } else if (liq > 200_000) score += 3;
    else if (liq < 50_000) {
      score -= 6;
      reasons.push(`thin liquidity ($${(liq / 1e3).toFixed(0)}K): higher swap cost`);
    }

    // 3. Risk profile vs beta
    if (riskProfile === "Conservative") {
      score += (2.2 - stock.beta) * 14;
      if (stock.beta <= 1.3) reasons.push(`lower volatility (beta ${stock.beta.toFixed(2)}) for a conservative profile`);
    } else if (riskProfile === "Aggressive") {
      score += (stock.beta - 1.0) * 16;
      if (stock.beta >= 1.6) reasons.push(`higher volatility (beta ${stock.beta.toFixed(2)}) for an aggressive profile`);
    } else score += 10 - Math.abs(1.45 - stock.beta) * 8;

    // 4. Stale oracle penalty
    if (stock.isOracleStale) {
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
  const selected = [...named, ...others].slice(0, Math.max(1, wanted)).sort((a, b) => b.rawScore - a.rawScore);
  const added = selected.filter((x) => !mandate.include.includes(x.stock.symbol) && !themeOf(x.stock.symbol).length).length;
  if (added > 0 && (mandate.include.length || mandate.themes.length) && !mandate.only)
    interpretation.push(`Added ${added} more by score to diversify (say "only" to keep just what you named).`);
  if (mandate.count && mandate.count > pool.length) interpretation.push(`Only ${pool.length} stock${pool.length > 1 ? "s" : ""} match, so the basket has ${pool.length}.`);
  let weights: number[];
  if (mandate.equalWeight) {
    const base = Math.floor(10000 / selected.length / 50) * 50;
    weights = selected.map(() => base);
    weights[0] += 10000 - base * selected.length;
  } else {
    // Weight strength relative to the weakest selected stock keeps weights differentiated
    const floor = Math.min(...selected.map((x) => x.rawScore)) - 20;
    weights = scoresToWeightsBps(selected.map((x) => x.rawScore - floor + 45));
  }

  // The weight limit is never broken. When the stocks can't hold all the money under it, the rest stays
  // in USDC instead (e.g. 3 stocks x max 30% = 90% invested, 10% kept)
  const limits: AgentAnalysisReport["limits"] = [];
  let maxWeightOfStocksPct: number | undefined;
  if (capPct) {
    const n = selected.length;
    if (n * capPct < investPct - 1e-9) {
      const kept = 100 - n * capPct;
      limits.push({
        label: `Max ${capPct}% per stock`,
        status: "kept",
        detail: `${n} stock${n > 1 ? "s" : ""} at ${capPct}% each can hold only ${n * capPct}% of your money, so I kept the limit and ${(kept - askedCashPct).toFixed(0)}% more stays in USDC.`,
      });
      investPct = n * capPct;
    }
    const capOfStocks = (capPct / investPct) * 10000;
    const capBps = Math.max(capOfStocks, Math.ceil(10000 / n));
    weights = capWeightsBps(weights, capBps) ?? weights;
    maxWeightOfStocksPct = Math.round(capOfStocks) / 100;
    if (!limits.length) {
      const top = Math.max(...weights) * (investPct / 10000);
      limits.push({ label: `Max ${capPct}% per stock`, status: "kept", detail: `The largest position is ${top.toFixed(1)}% of your money.` });
    }
  }
  if (askedCashPct) limits.push({ label: `Keep ${askedCashPct}% in USDC`, status: "kept", detail: `${askedCashPct}% of the amount is not invested.` });
  for (const sym of mandate.exclude) {
    if (stocks.some((st) => st.symbol === sym) && pool.every((p) => p.symbol !== sym))
      limits.push({ label: `No ${sym}`, status: "kept", detail: "Left out of the basket." });
  }
  if (mandate.count && selected.length < mandate.count)
    limits.push({ label: `${mandate.count} stocks`, status: "adjusted", detail: `Only ${selected.length} match the rest of your request.` });
  for (const u of mandate.unavailable)
    limits.push({
      label: u.name,
      status: "not possible",
      detail: u.sector
        ? "None of the 10 Coinbase tokenized stocks on Base is in this group."
        : `Not one of the 10 Coinbase tokenized stocks on Base${u.closest ? `. Closest available: ${u.closest}.` : "."}`,
    });
  if (mandate.unavailable.length && !mandate.include.length && !mandate.themes.length)
    interpretation.push("Nothing you asked for is available as a tokenized stock yet, so this basket is built from all 10 by score.");
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

  const topTickers = allocations.map((a) => `${a.symbol} ${(a.targetWeightBps / 100).toFixed(1)}%`).join(", ");
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
    if (s.dexPairAddress && /^0x[0-9a-fA-F]{40}$/.test(s.dexPairAddress)) {
      parts.push(`DEX ${fmt(s.dexPrice24_7)}, ${s.weekendGapPct >= 0 ? "+" : ""}${s.weekendGapPct.toFixed(2)}% vs NAV`);
      if (s.dexLiquidityUsd) parts.push(`pool liquidity ${s.dexLiquidityUsd >= 1e6 ? `$${(s.dexLiquidityUsd / 1e6).toFixed(1)}M` : `$${Math.round(s.dexLiquidityUsd / 1e3)}K`}`);
      links.push({ label: "DEX pool", url: `https://dexscreener.com/base/${s.dexPairAddress}` });
    } else parts.push("no live DEX quote, NAV used");
    if (s.uiMultiplier > 1.0001) parts.push(`multiplier ${s.uiMultiplier.toFixed(4)}x`);
    links.push({ label: "Token", url: `https://basescan.org/token/${s.b20Address}` });
    return { symbol: s.symbol, text: parts.join(" · "), links };
  });

  // Assumptions: what the request didn't say, so the agent chose
  const assumptions: string[] = [];
  if (!mandate.count) assumptions.push(`No number of stocks given: I picked ${selected.length}${capPct ? " (enough to stay under your limit)" : ""}.`);
  assumptions.push(mandate.equalWeight ? "Equal weights, as you asked." : "No weights given: they follow each stock's rule score.");
  assumptions.push(`Risk profile: ${riskProfile.toLowerCase()}${riskProfile === params.riskProfile ? " (the selected setting)" : " (from your words)"}. Beta values are fixed estimates, not live.`);
  if (usMarketStatus().state !== "open") assumptions.push("The US market is closed: NAV is the last close, and DEX prices can drift from it until the next open.");
  assumptions.push("Prices are from now. The exact amount is quoted again in the review, before you sign.");

  const executiveSummary = `Proposed ${riskProfile.toLowerCase()} basket from live Chainlink NAV, DEX prices, liquidity and B20 multipliers across all 10 Coinbase tokenized stocks: ${topTickers}. Not financial advice — review before buying.`;

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
