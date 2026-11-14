import { NextRequest, NextResponse } from "next/server";
import { runAutonomousStockAgent } from "@/lib/agentEngine";
import { BASE_TOKENIZED_STOCKS, LiveTokenizedStock } from "@/lib/tokenizedStocks";
import { GET as getStocks } from "../stocks/route";

/**
 * Runs the rule-based stock agent over LIVE market data only.
 *
 * Input hardening:
 *  - Only the 10 official Coinbase B20 stocks are analysed. Static metadata (score base, beta, addresses)
 *    always comes from the server; only live numbers are taken from the client, and only within sane ranges.
 *  - Prompt length, amount and risk profile are bounded; the Builder Code is always the project's own.
 *  - No server-side trade execution and no user API keys: users execute from their own wallet.
 */
const MAX_PROMPT_CHARS = 500;
const MAX_BODY_BYTES = 200_000;
const RISK = ["Conservative", "Balanced", "Aggressive"] as const;
const BUILDER_CODE = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";

const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Rebuilds the stock list from the server whitelist, merging only sane live numbers from the client. */
function sanitizeStocks(input: unknown): LiveTokenizedStock[] {
  if (!Array.isArray(input) || input.length > 50) return [];
  const byAddr = new Map<string, Record<string, unknown>>();
  for (const s of input) {
    if (s && typeof s === "object" && typeof (s as { b20Address?: unknown }).b20Address === "string") {
      byAddr.set(((s as { b20Address: string }).b20Address).toLowerCase(), s as Record<string, unknown>);
    }
  }
  const out: LiveTokenizedStock[] = [];
  for (const meta of BASE_TOKENIZED_STOCKS) {
    const c = byAddr.get(meta.b20Address.toLowerCase());
    if (!c || !inRange(c.navPrice, 0.01, 1_000_000) || !inRange(c.dexPrice24_7, 0.01, 1_000_000)) continue;
    out.push({
      ...meta, // server-side metadata wins (aiScoreBase, beta, addresses, sector…)
      navPrice: c.navPrice,
      dexPrice24_7: c.dexPrice24_7,
      weekendGapPct: inRange(c.weekendGapPct, -50, 50) ? c.weekendGapPct : 0,
      weekendSignal: "FAIR_PARITY",
      dexLiquidityUsd: inRange(c.dexLiquidityUsd, 0, 1e11) ? c.dexLiquidityUsd : undefined,
      dexPairAddress: typeof c.dexPairAddress === "string" && /^0x[0-9a-fA-F]{40}$/.test(c.dexPairAddress) ? c.dexPairAddress : undefined,
      dexVolume24hUsd: inRange(c.dexVolume24hUsd, 0, 1e11) ? c.dexVolume24hUsd : undefined,
      uiMultiplier: inRange(c.uiMultiplier, 0.5, 10) ? c.uiMultiplier : meta.defaultMultiplier,
      isOracleStale: c.isOracleStale === true,
      navPriceUpdatedAt: "",
      navPriceTimestamp: 0,
      oracleAgeMinutes: inRange(c.oracleAgeMinutes, 0, 1e7) ? c.oracleAgeMinutes : -1,
      totalSupplyTokens: 0,
      totalSupplySharesUI: 0,
      onchainMarketCapUsd: 0,
      change24hPct: inRange(c.change24hPct, -100, 1000) ? c.change24hPct : 0,
      source: "base-mainnet-onchain",
    });
  }
  return out;
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Request too large." }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const userPrompt = String(body.userPrompt ?? "AI and cloud compute leaders, prefer stocks trading below NAV")
      .slice(0, MAX_PROMPT_CHARS);
    const riskProfile = RISK.includes(body.riskProfile as (typeof RISK)[number])
      ? (body.riskProfile as (typeof RISK)[number])
      : "Balanced";
    const capitalUsd = inRange(Number(body.capitalUsd), 1, 100_000) ? Number(body.capitalUsd) : 20;

    let stocksToAnalyze = sanitizeStocks(body.stocks);
    if (stocksToAnalyze.length < 5) {
      // In-process call (shares the 15s market cache). A self-fetch over HTTP failed on Vercel, and it
      // would also trust the Host header for the URL.
      const liveRes = await getStocks(new NextRequest(new URL("/api/stocks", request.url)));
      const liveData = liveRes.ok ? await liveRes.json() : null;
      stocksToAnalyze = sanitizeStocks(liveData?.stocks);
    }
    if (stocksToAnalyze.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Live market data is unavailable right now. Please retry in a moment." },
        { status: 503 }
      );
    }

    const currentWeights =
      body.currentWeights && typeof body.currentWeights === "object" ? (body.currentWeights as Record<string, number>) : {};

    const report = runAutonomousStockAgent({
      stocks: stocksToAnalyze,
      userPrompt,
      riskProfile,
      capitalUsd,
      builderCode: BUILDER_CODE,
      currentWeights,
    });

    return NextResponse.json({ ok: true, report });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to run the stock agent. Please retry." }, { status: 500 });
  }
}
