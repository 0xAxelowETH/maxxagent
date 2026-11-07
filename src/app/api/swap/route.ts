import { NextRequest, NextResponse } from "next/server";
import { Attribution } from "ox/erc8021";
import { createPublicClient, parseAbi } from "viem";
import { base } from "viem/chains";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { baseTransport } from "@/lib/rpc";
import { alignedWithSuffix } from "@/lib/builderCode";

/**
 * Swap builder between USDC and Coinbase B20 tokenized stocks (KyberSwap Aggregator on Base).
 *   side "buy"  (default): USDC -> stock, sized by `amountUsd`
 *   side "sell":           stock -> USDC, sized by `amountTokens` (stock token units)
 *
 * - Only the 10 official Coinbase-issued B20 addresses are allowed.
 * - The project's ERC-8021 Builder Code is appended server-side, so every swap is attributed.
 * - Routes whose total cost (price impact + fees) exceeds MAX_COST_PCT are refused.
 * - Returns an unsigned transaction: the user signs it from their own wallet (non-custodial).
 */
const KYBER_API = "https://aggregator-api.kyberswap.com/base/api/v1";
const KYBER_HEADERS = { "x-client-id": "maxxagent", "content-type": "application/json" };
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BUILDER_CODE = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";

const MIN_USD = 1;
const MIN_SELL_USD = 0.25; // allow selling small positions
const MAX_USD_PER_LEG = 2500;
const MAX_COST_PCT = 1.5;
const DEFAULT_SLIPPAGE_BPS = 50; // 0.50%
const MAX_SLIPPAGE_BPS = 200; // 2.00%

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KYBER_TIMEOUT_MS = 8000;

// The user approves tokens to the router, so never trust a router address from the API response:
// only KyberSwap's MetaAggregationRouterV2 on Base is accepted.
const ALLOWED_ROUTERS = new Set(["0x6131b5fae19ea4f9d964eac0408e4408b66337b5"]);

// Price guard against the Chainlink NAV: refuse to pay (buy) or accept (sell) a price more than
// MAX_NAV_DEVIATION_PCT worse than NAV. Kyber's own USD numbers come from the same pools, so they
// can't catch a thin or manipulated pool on their own. Skipped when NAV is older than 4 days
// (24/5 feed over long market closures) or unreadable; the cost guard still applies then.
const MAX_NAV_DEVIATION_PCT = 5;
const MAX_NAV_AGE_SEC = 4 * 86_400;
const FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const client = createPublicClient({ chain: base, transport: baseTransport({ timeout: 6000 }) });

async function readNav(feed: `0x${string}`): Promise<number | null> {
  try {
    const [, answer, , updatedAt] = await client.readContract({ address: feed, abi: FEED_ABI, functionName: "latestRoundData" });
    const age = Date.now() / 1000 - Number(updatedAt);
    return answer > 0n && age >= 0 && age < MAX_NAV_AGE_SEC ? Number(answer) / 1e8 : null;
  } catch {
    return null;
  }
}

interface KyberRouteHop {
  exchange: string;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (rawBody.length > 10_000) {
    return NextResponse.json({ ok: false, error: "Request too large." }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  try {
    const side = body?.side === "sell" ? "sell" : "buy";
    const stockAddress = String(body?.stockAddress || "").toLowerCase();
    const sender = String(body?.sender || "");
    const amountUsd = Number(body?.amountUsd);
    const amountTokens = Number(body?.amountTokens);
    const slippageBps = Math.min(
      MAX_SLIPPAGE_BPS,
      Math.max(10, Number(body?.slippageBps) || DEFAULT_SLIPPAGE_BPS)
    );

    const stock = BASE_TOKENIZED_STOCKS.find((s) => s.b20Address.toLowerCase() === stockAddress);
    if (!stock) {
      return NextResponse.json({ ok: false, error: "Unsupported token: only Coinbase B20 stocks are allowed." }, { status: 400 });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(sender)) {
      return NextResponse.json({ ok: false, error: "Invalid wallet address." }, { status: 400 });
    }
    if (side === "buy" && (!Number.isFinite(amountUsd) || amountUsd < MIN_USD || amountUsd > MAX_USD_PER_LEG)) {
      return NextResponse.json(
        { ok: false, error: `Amount per stock must be between $${MIN_USD} and $${MAX_USD_PER_LEG}.` },
        { status: 400 }
      );
    }
    if (side === "sell" && (!Number.isFinite(amountTokens) || amountTokens <= 0 || amountTokens > 1_000_000)) {
      return NextResponse.json({ ok: false, error: "Invalid amount of stock tokens to sell." }, { status: 400 });
    }

    // Buy: USDC (6 decimals) in. Sell: stock tokens (B20 decimals) in.
    const tokenIn = side === "buy" ? USDC_BASE : stock.b20Address;
    const tokenOut = side === "buy" ? stock.b20Address : USDC_BASE;
    const amountIn =
      side === "buy"
        ? BigInt(Math.floor(amountUsd * 1e6))
        : // round, not floor: x/1e8*1e8 can land at n-0.0000001 and leave 1 unit of dust on "Sell all"
          BigInt(Math.round(amountTokens * 10 ** stock.decimals));
    if (amountIn <= 0n) {
      return NextResponse.json({ ok: false, error: "Amount too small." }, { status: 400 });
    }

    type Build = { code?: number; message?: string; data?: { data: string; routerAddress: string; transactionValue?: string; amountOut: string } };
    const getQuote = async (excluded: string[]) => {
      // KyberSwap answers 403 "Forbidden" when called too fast: retry with backoff
      const exclude = excluded.length ? `&excludedSources=${encodeURIComponent(excluded.join(","))}` : "";
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await sleep(700 * attempt);
        const res = await fetch(
          `${KYBER_API}/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}${exclude}`,
          { headers: KYBER_HEADERS, cache: "no-store", signal: AbortSignal.timeout(KYBER_TIMEOUT_MS) }
        ).catch(() => null);
        const q = res ? await res.json().catch(() => null) : null;
        if (q?.code === 0 && q?.data?.routeSummary) return q.data.routeSummary;
      }
      return null;
    };
    const buildRoute = async (summary: unknown): Promise<Build | null> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await sleep(900 * attempt); // 403 "Forbidden" = aggregator rate limit
        const res = await fetch(`${KYBER_API}/route/build`, {
          method: "POST",
          headers: KYBER_HEADERS,
          cache: "no-store",
          signal: AbortSignal.timeout(KYBER_TIMEOUT_MS),
          body: JSON.stringify({ routeSummary: summary, sender, recipient: sender, slippageTolerance: slippageBps, source: "maxxagent" }),
        }).catch(() => null);
        const b = (res ? await res.json().catch(() => null) : null) as Build | null;
        if (b?.code === 0 && b.data) return b;
      }
      return null;
    };

    // 1+2. Quote, then build for this sender (recipient = sender: stocks go straight to the user's wallet).
    // Private market-maker (PMM / prop / RFQ) legs sometimes refuse to build: re-route without them.
    const excluded: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let routeSummary: any = null;
    let build: Build | null = null;
    for (let round = 0; round < 2 && !build; round++) {
      routeSummary = await getQuote(excluded);
      if (!routeSummary) break;
      const exchanges = [...new Set((routeSummary.route as KyberRouteHop[][]).flat().map((h) => h.exchange))];
      const amountInUsdR = Number(routeSummary.amountInUsd) || amountUsd;
      const costR = amountInUsdR > 0 ? ((amountInUsdR - (Number(routeSummary.amountOutUsd) || 0)) / amountInUsdR) * 100 : 100;
      if (!(costR <= MAX_COST_PCT)) break; // handled below (also catches NaN)
      build = await buildRoute(routeSummary);
      if (!build) {
        const pmm = exchanges.filter((x) => /pmm|prop|rfq|tidefi|kipseli|metric/i.test(x));
        if (pmm.length === 0) break;
        excluded.push(...pmm);
      }
    }
    if (!routeSummary) {
      return NextResponse.json(
        { ok: false, symbol: stock.symbol, error: `No route available for ${stock.symbol} right now.` },
        { status: 502 }
      );
    }
    const venues = [...new Set((routeSummary.route as KyberRouteHop[][]).flat().map((h) => h.exchange))];
    const amountInUsd = Number(routeSummary.amountInUsd) || amountUsd;
    const amountOutUsd = Number(routeSummary.amountOutUsd) || 0;
    const costPct = amountInUsd > 0 ? ((amountInUsd - amountOutUsd) / amountInUsd) * 100 : 100;

    if (!Number.isFinite(costPct) || !Number.isFinite(amountInUsd)) {
      // No USD pricing from the aggregator = the cost guard can't run: refuse rather than skip it
      return NextResponse.json(
        { ok: false, symbol: stock.symbol, error: `Could not price the ${stock.symbol} route. Please retry.` },
        { status: 502 }
      );
    }
    if (side === "sell" && (amountInUsd < MIN_SELL_USD || amountInUsd > MAX_USD_PER_LEG)) {
      return NextResponse.json(
        { ok: false, symbol: stock.symbol, error: `Sell value must be between $${MIN_SELL_USD} and $${MAX_USD_PER_LEG}.` },
        { status: 400 }
      );
    }
    if (costPct > MAX_COST_PCT) {
      return NextResponse.json(
        {
          ok: false,
          symbol: stock.symbol,
          costPct,
          error: `${stock.symbol} route costs ${costPct.toFixed(2)}% (limit ${MAX_COST_PCT}%). Skipped to protect you from low liquidity.`,
        },
        { status: 422 }
      );
    }
    if (!build?.data) {
      return NextResponse.json(
        { ok: false, symbol: stock.symbol, error: `Could not build ${stock.symbol} swap. Please retry.` },
        { status: 502 }
      );
    }

    // Never hand the wallet an approval target or ETH value we didn't expect
    if (!ALLOWED_ROUTERS.has(String(build.data.routerAddress).toLowerCase())) {
      console.error("swap route: unexpected router", build.data.routerAddress);
      return NextResponse.json({ ok: false, symbol: stock.symbol, error: "Unexpected swap router. Swap refused for your safety." }, { status: 502 });
    }
    if (BigInt(build.data.transactionValue || "0") !== 0n) {
      return NextResponse.json({ ok: false, symbol: stock.symbol, error: "Unexpected ETH value in swap. Swap refused for your safety." }, { status: 502 });
    }

    const amountOutRaw = BigInt(build.data.amountOut || routeSummary.amountOut);

    // NAV guard: effective price per stock token vs Chainlink NAV (per token, multiplier-adjusted)
    const nav = await readNav(stock.chainlinkFeed);
    let navDeviationPct: number | null = null;
    if (nav && amountOutRaw > 0n) {
      const tokens = side === "buy" ? Number(amountOutRaw) / 10 ** stock.decimals : Number(amountIn) / 10 ** stock.decimals;
      const usdc = side === "buy" ? Number(amountIn) / 1e6 : Number(amountOutRaw) / 1e6;
      const effPrice = usdc / tokens;
      // positive = worse for the user (paying above NAV on a buy, receiving below NAV on a sell)
      navDeviationPct = side === "buy" ? (effPrice / nav - 1) * 100 : (1 - effPrice / nav) * 100;
      if (navDeviationPct > MAX_NAV_DEVIATION_PCT) {
        return NextResponse.json(
          {
            ok: false,
            symbol: stock.symbol,
            navDeviationPct,
            error: `${stock.symbol} price is ${navDeviationPct.toFixed(1)}% worse than its NAV (limit ${MAX_NAV_DEVIATION_PCT}%). Skipped to protect you.`,
          },
          { status: 422 }
        );
      }
    }

    // 3. Append ERC-8021 Builder Code (routers ignore trailing calldata).
    // Zero-pad BEFORE the suffix so the call data is a multiple of 32 bytes. Batching wallets
    // (EIP-7702 execute, ERC-4337 executeBatch) ABI-encode the calls, and ABI padding after our
    // suffix hid it from indexers, which read the suffix from the very end of the tx / UserOp input.
    // With 32-byte alignment there is no padding, so the outer input ends with our suffix.
    const data = alignedWithSuffix(build.data.data, Attribution.toDataSuffix({ codes: [BUILDER_CODE] }));
    const minAmountOutRaw = (amountOutRaw * BigInt(10_000 - slippageBps)) / 10_000n;

    return NextResponse.json({
      ok: true,
      side,
      symbol: stock.symbol,
      b20Address: stock.b20Address,
      tokenIn,
      tokenOut,
      routerAddress: build.data.routerAddress,
      tx: {
        to: build.data.routerAddress,
        data,
        value: build.data.transactionValue || "0",
      },
      amountInRaw: amountIn.toString(),
      amountOutRaw: amountOutRaw.toString(),
      minAmountOutRaw: minAmountOutRaw.toString(),
      // buy: stock tokens out · sell: USDC out
      amountOutShares: side === "buy" ? Number(amountOutRaw) / 10 ** stock.decimals : undefined,
      amountOutUsdc: side === "sell" ? Number(amountOutRaw) / 1e6 : undefined,
      amountInTokens: side === "sell" ? Number(amountIn) / 10 ** stock.decimals : undefined,
      amountInUsd,
      amountOutUsd,
      costPct,
      nav,
      navDeviationPct,
      slippageBps,
      venues,
      builderCode: BUILDER_CODE,
    });
  } catch (error: unknown) {
    console.error("swap route error", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "Swap quote failed. Please retry." }, { status: 500 });
  }
}
