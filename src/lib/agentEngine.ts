import { LiveTokenizedStock } from "./tokenizedStocks";
import { appendBuilderCodeToCalldata, toErc8021DataSuffix } from "./builderCode";
import { INDEX_REGISTRY_ABI } from "./contracts/StockMaxxIndexRegistryABI";
import { encodeFunctionData, keccak256, toHex } from "viem";
import { THEMES, parseMandate } from "./mandate";

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
  // Named stocks always make it in; the rest is filled by score
  const wanted = Math.min(pool.length, Math.max(mandate.count ?? 5, mandate.count ? 0 : mandate.include.length));
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

  const allocations: AgentAllocationRecommendation[] = selected.map((item, idx) => {
    const s = item.stock;
    const targetWeightBps = weights[idx];
    const currentWeightBps = currentWeights[s.symbol] ?? 0;
    const deltaBps = targetWeightBps - currentWeightBps;
    const usdAllocation = (capitalUsd * targetWeightBps) / 10000;
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
