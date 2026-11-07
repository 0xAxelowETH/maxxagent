import { LiveTokenizedStock } from "./tokenizedStocks";
import { appendBuilderCodeToCalldata, toErc8021DataSuffix } from "./builderCode";
import { INDEX_REGISTRY_ABI } from "./contracts/StockMaxxIndexRegistryABI";
import { encodeFunctionData, keccak256, toHex } from "viem";

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
  const { stocks, userPrompt, riskProfile, capitalUsd, builderCode, currentWeights = {} } = params;
  const promptLower = userPrompt.toLowerCase();
  const hasWord = (...words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(promptLower));

  const scored = stocks.map((stock) => {
    let score = stock.aiScoreBase;

    // 1. Mandate keywords
    if (
      promptLower.includes(stock.symbol.toLowerCase()) ||
      hasWord(stock.tickerUnderlying.toLowerCase(), stock.companyName.toLowerCase().split(" ")[0])
    ) {
      score += 32;
    }
    if (
      hasWord("ai", "chip", "chips", "gpu", "compute") &&
      (stock.sector === "AI & Semiconductors" || ["MSFTc", "GOOGLc", "METAc"].includes(stock.symbol))
    ) {
      score += 18;
    }
    if (hasWord("space", "frontier", "bitcoin", "btc", "moon") && stock.sector === "Frontier & Crypto") {
      score += 22;
    }
    if (
      hasWord("safe", "dividend", "defensive", "bluechip", "cloud") &&
      (stock.sector === "Big Tech Cloud" || stock.symbol === "AAPLc")
    ) {
      score += 18;
    }
    if (hasWord("discount", "weekend", "gap") && stock.weekendGapPct < 0) {
      score += Math.min(25, Math.abs(stock.weekendGapPct) * 35);
    }

    // 2. Live market factors
    // A: DEX trading below Chainlink NAV (cheaper entry), penalise premiums
    if (stock.weekendGapPct < -0.05) score += Math.min(8, Math.abs(stock.weekendGapPct) * 12);
    else if (stock.weekendGapPct > 0.5) score -= Math.min(6, stock.weekendGapPct * 4);
    // B: reinvested dividends reflected in the multiplier
    if (stock.uiMultiplier > 1.0001) score += 4;
    // C: liquidity depth (execution quality); unknown liquidity gets no bonus
    const liq = stock.dexLiquidityUsd ?? 0;
    if (liq > 500_000) score += 5;
    else if (liq > 200_000) score += 3;
    else if (liq < 50_000) score -= 6;

    // 3. Risk profile vs beta
    if (riskProfile === "Conservative") score += (2.2 - stock.beta) * 14;
    else if (riskProfile === "Aggressive") score += (stock.beta - 1.0) * 16;
    else score += 10 - Math.abs(1.45 - stock.beta) * 8;

    // 4. Stale oracle penalty
    if (stock.isOracleStale) score -= 8;

    // rawScore drives ranking & weights (uncapped, so strong preferences stay distinguishable);
    // quantScore is the capped 55–99 display value.
    return { stock, rawScore: score, quantScore: Math.min(99, Math.max(55, Math.round(score))) };
  });

  scored.sort((a, b) => b.rawScore - a.rawScore);
  const selected = scored.slice(0, 5);
  // Weight strength relative to the weakest selected stock keeps weights differentiated
  const floor = Math.min(...selected.map((s) => s.rawScore)) - 20;
  const weights = scoresToWeightsBps(selected.map((s) => s.rawScore - floor + 45));

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

    const gapNote =
      s.weekendGapPct <= -0.05
        ? `trades ${Math.abs(s.weekendGapPct).toFixed(2)}% below Chainlink NAV on DEX ($${s.dexPrice24_7.toFixed(2)} vs $${s.navPrice.toFixed(2)})`
        : `trades at $${s.dexPrice24_7.toFixed(2)} on DEX vs $${s.navPrice.toFixed(2)} Chainlink NAV (${s.weekendGapPct >= 0 ? "+" : ""}${s.weekendGapPct.toFixed(2)}%)`;
    const liqNote = s.dexLiquidityUsd
      ? `$${(s.dexLiquidityUsd / 1e3).toFixed(0)}K DEX liquidity`
      : "DEX liquidity unknown";

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
      rationale: `${s.companyName} (${s.symbol}) ${gapNote}, multiplier ${s.uiMultiplier.toFixed(6)}x, ${liqNote}, beta ${s.beta.toFixed(2)}. Rule score ${item.quantScore}/99.`,
    };
  });

  const topTickers = allocations.map((a) => `${a.symbol} ${(a.targetWeightBps / 100).toFixed(1)}%`).join(", ");
  const isFrontier = hasWord("frontier", "space");
  const isSafe = hasWord("safe", "defensive");
  const strategyName = isFrontier
    ? "MAXX Frontier Basket"
    : isSafe
    ? "MAXX Fortress Basket"
    : "MAXX Agentic Stock Basket";
  const strategyTicker = isFrontier ? "MAXX-FRNT" : isSafe ? "MAXX-SAFE" : "MAXX-AI";

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
