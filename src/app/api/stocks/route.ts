import https from "node:https";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { baseTransport } from "@/lib/rpc";
import { base } from "viem/chains";
import {
  BASE_TOKENIZED_STOCKS,
  B20_AND_CHAINLINK_ABI,
  COINBASE_ORACLE_REGISTRY_ADDRESS,
  LiveTokenizedStock,
} from "@/lib/tokenizedStocks";

const publicClient = createPublicClient({
  chain: base,
  transport: baseTransport({ timeout: 8000 }),
});
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

interface DexScreenerPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: {
    address?: string;
    symbol?: string;
  };
  priceUsd?: string;
  volume?: {
    h24?: number;
  };
  priceChange?: {
    h24?: number;
  };
  liquidity?: {
    usd?: number;
  };
  txns?: {
    h24?: {
      buys?: number;
      sells?: number;
    };
  };
}

// Emergency fallback snapshots only if RPC + DEX APIs are simultaneously unreachable
const FALLBACK_PRICES: Record<
  string,
  { price: number; supply: number; mult: number; change24h: number; dexSpreadPct: number }
> = {
  NVDAc: { price: 185.57, supply: 33568.58, mult: 1.00053794, change24h: -8.59, dexSpreadPct: -0.01 },
  AAPLc: { price: 345.09, supply: 6975.68, mult: 1.0, change24h: -2.55, dexSpreadPct: 0.01 },
  TSLAc: { price: 342.44, supply: 6322.14, mult: 1.0, change24h: -4.12, dexSpreadPct: 0.12 },
  MSFTc: { price: 541.52, supply: 2630.51, mult: 1.0, change24h: -1.45, dexSpreadPct: -0.05 },
  METAc: { price: 607.39, supply: 7815.65, mult: 1.00031379, change24h: -4.58, dexSpreadPct: 0.20 },
  GOOGLc: { price: 285.28, supply: 33288.24, mult: 1.00037712, change24h: -1.85, dexSpreadPct: -0.08 },
  AMZNc: { price: 254.02, supply: 8968.22, mult: 1.0, change24h: -2.10, dexSpreadPct: 0.06 },
  MSTRc: { price: 129.88, supply: 13510.42, mult: 1.0, change24h: -5.40, dexSpreadPct: 0.34 },
  SNDKc: { price: 882.22, supply: 1858.02, mult: 1.0, change24h: 1.15, dexSpreadPct: -0.14 },
  SPCXc: { price: 126.55, supply: 22014.11, mult: 1.0, change24h: 2.34, dexSpreadPct: 0.28 },
};

/**
 * Resolves api.coinbase.com via Cloudflare DNS-over-HTTPS (DoH) so ISP DNS blocks (e.g., Telkomsel internetbaik)
 * do not break TLS SNI verification.
 */
async function fetchCoinbaseTokenizedStocksViaDoH(): Promise<
  Record<string, { multiplier?: number; navPrice?: number }>
> {
  const result: Record<string, { multiplier?: number; navPrice?: number }> = {};
  try {
    const dohCtrl = new AbortController();
    const dohTimer = setTimeout(() => dohCtrl.abort(), 2000);
    const dohRes = await fetch("https://cloudflare-dns.com/dns-query?name=api.coinbase.com&type=A", {
      signal: dohCtrl.signal,
      headers: { Accept: "application/dns-json" },
    });
    clearTimeout(dohTimer);
    if (!dohRes.ok) return result;
    const dohJson = await dohRes.json();
    const ip = dohJson?.Answer?.find((a: { type: number; data?: string }) => a.type === 1)?.data;
    if (!ip) return result;

    const rawBody = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          host: ip,
          port: 443,
          path: "/v1/tokenized-stocks?page_size=50",
          method: "GET",
          servername: "api.coinbase.com",
          headers: {
            Host: "api.coinbase.com",
            Accept: "application/json",
            "User-Agent": "MAXXAGENT-BaseStocksMaxxing/1.0",
          },
          timeout: 2200,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve(body));
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("timeout"));
      });
      req.end();
    });

    const parsed = JSON.parse(rawBody);
    const records = parsed?.tokenized_stocks || parsed?.tokens || parsed?.data || [];
    if (Array.isArray(records)) {
      for (const r of records) {
        if (r?.symbol) {
          result[r.symbol] = {
            multiplier: r.multiplier ? Number(r.multiplier) : undefined,
            navPrice: r.nav_price ? Number(r.nav_price) : undefined,
          };
        }
      }
    }
  } catch {
    // Gracefully fall back to direct Base Mainnet B20 + Chainlink + Aerodrome DEX reads
  }
  return result;
}

/**
 * Queries real 24/7 DEX liquidity pools on Base Mainnet (Aerodrome / Uniswap) via DexScreener API
 */
async function fetchLiveBaseDexPools(): Promise<Record<string, DexScreenerPair>> {
  const bestPoolByAddress: Record<string, DexScreenerPair> = {};
  const totals: Record<string, { liq: number; vol: number; buys: number; sells: number }> = {};
  try {
    const allAddresses = BASE_TOKENIZED_STOCKS.map((s) => s.b20Address).join(",");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/base/${allAddresses}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
      next: { revalidate: 15 },
    });
    clearTimeout(timer);
    if (res.ok) {
      const pairs = (await res.json()) as DexScreenerPair[];
      if (Array.isArray(pairs)) {
        for (const pair of pairs) {
          const addrLower = pair?.baseToken?.address?.toLowerCase();
          if (!addrLower || !pair?.priceUsd) continue;
          const t = (totals[addrLower] ||= { liq: 0, vol: 0, buys: 0, sells: 0 });
          t.liq += pair.liquidity?.usd ?? 0;
          t.vol += pair.volume?.h24 ?? 0;
          t.buys += pair.txns?.h24?.buys ?? 0;
          t.sells += pair.txns?.h24?.sells ?? 0;
          const existing = bestPoolByAddress[addrLower];
          const currLiq = pair.liquidity?.usd ?? 0;
          const prevLiq = existing?.liquidity?.usd ?? -1;
          if (currLiq > prevLiq) {
            bestPoolByAddress[addrLower] = pair;
          }
        }
      }
    }
  } catch {
    // Gracefully fallback if DexScreener is rate-limited
  }
  // Price/URL from the deepest pool; liquidity, volume and txns aggregated across all pools
  for (const [addr, pool] of Object.entries(bestPoolByAddress)) {
    const t = totals[addr];
    if (!t) continue;
    bestPoolByAddress[addr] = {
      ...pool,
      liquidity: { usd: t.liq },
      volume: { h24: t.vol },
      txns: { h24: { buys: t.buys, sells: t.sells } },
    };
  }
  return bestPoolByAddress;
}

// Market data is the same for every visitor: build it at most every 15s and share it.
// Wallet requests reuse it and only add their own balance reads (one multicall).
const MARKET_TTL_MS = 15_000;
let marketCache: { at: number; stocks: LiveTokenizedStock[] } | null = null;
let marketInflight: Promise<LiveTokenizedStock[]> | null = null;

async function getMarket(): Promise<LiveTokenizedStock[]> {
  if (marketCache && Date.now() - marketCache.at < MARKET_TTL_MS) return marketCache.stocks;
  if (!marketInflight) {
    marketInflight = buildMarket()
      .then((stocks) => {
        // Don't pin a fully-fallback snapshot for 15s: retry on the next request
        if (stocks.some((s) => s.source !== "fallback-snapshot")) marketCache = { at: Date.now(), stocks };
        return stocks;
      })
      .finally(() => {
        marketInflight = null;
      });
  }
  return marketInflight;
}

async function buildMarket(): Promise<LiveTokenizedStock[]> {
  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Run Live Base DEX Pool discovery + DoH Coinbase API enrichment in parallel
  const [dexPoolsByAddr, coinbaseApiMap] = await Promise.all([
    fetchLiveBaseDexPools(),
    fetchCoinbaseTokenizedStocksViaDoH(),
  ]);

  // 2. Read live Chainlink Total-Return Feeds + B20 Precompile Total Supply & UI Multiplier on Base Mainnet
  const liveStocks: LiveTokenizedStock[] = await Promise.all(
    BASE_TOKENIZED_STOCKS.map(async (meta) => {
      const fb = FALLBACK_PRICES[meta.symbol] || {
        price: 200,
        supply: 1000,
        mult: 1.0,
        change24h: 1.5,
        dexSpreadPct: -0.1,
      };
      const liveDexPool = dexPoolsByAddr[meta.b20Address.toLowerCase()];

      try {
        const [roundData, rawSupplyHex, rawMultiplier] = await Promise.all([
          publicClient.readContract({
            address: meta.chainlinkFeed,
            abi: B20_AND_CHAINLINK_ABI,
            functionName: "latestRoundData",
          }),
          publicClient.readContract({
            address: meta.b20Address,
            abi: B20_AND_CHAINLINK_ABI,
            functionName: "totalSupply",
          }),
          publicClient
            .readContract({
              address: meta.b20Address,
              abi: B20_AND_CHAINLINK_ABI,
              functionName: "uiMultiplier",
            })
            .catch(() => 1000000000000000000n),
        ]);

        const [roundId, answer, , updatedAt, answeredInRound] = roundData;
        const isRoundValid = Number(answer) > 0 && Number(updatedAt) > 0 && answeredInRound >= roundId;
        const navPrice = isRoundValid ? Number(answer) / 1e8 : fb.price;
        const updatedAtNum = Number(updatedAt);
        const oracleAgeMinutes = Math.max(0, Math.round((nowSec - updatedAtNum) / 60));
        const isOracleStale = !isRoundValid || nowSec - updatedAtNum > 26 * 3600;
        const totalSupplyTokens = Number(rawSupplyHex) / Math.pow(10, meta.decimals);
        const uiMultiplier =
          coinbaseApiMap[meta.symbol]?.multiplier ??
          (Number(rawMultiplier) > 0 ? Number(rawMultiplier) / 1e18 : meta.defaultMultiplier);
        const totalSupplySharesUI = totalSupplyTokens * uiMultiplier;
        // Chainlink total-return NAV is the per-token value (already multiplier-adjusted)
        const onchainMarketCapUsd = totalSupplyTokens * navPrice;

        // Compute REAL 24/7 DEX price vs 24/5 Chainlink NAV gap from Aerodrome on Base
        const hasLiveDex = Boolean(liveDexPool?.priceUsd && Number(liveDexPool.priceUsd) > 0);
        // No live DEX quote => no gap claimed (never synthesize a spread)
        const dexPrice24_7 = hasLiveDex
          ? Number(Number(liveDexPool!.priceUsd).toFixed(2))
          : Number(navPrice.toFixed(2));

        const weekendGapPct = Number((((dexPrice24_7 - navPrice) / navPrice) * 100).toFixed(2));
        const weekendSignal: "BUY_DEX_DISCOUNT" | "SHORT_DEX_PREMIUM" | "FAIR_PARITY" =
          weekendGapPct <= -0.15
            ? "BUY_DEX_DISCOUNT"
            : weekendGapPct >= 0.15
            ? "SHORT_DEX_PREMIUM"
            : "FAIR_PARITY";

        const change24hPct =
          liveDexPool?.priceChange?.h24 !== undefined ? Number(liveDexPool.priceChange.h24) : fb.change24h;
        const dexTxns24h =
          (liveDexPool?.txns?.h24?.buys ?? 0) + (liveDexPool?.txns?.h24?.sells ?? 0);

        return {
          ...meta,
          navPrice,
          dexPrice24_7,
          weekendGapPct,
          weekendSignal,
          dexPairAddress: liveDexPool?.pairAddress,
          dexId: liveDexPool?.dexId === "aero" ? "Aerodrome Finance" : liveDexPool?.dexId,
          dexLiquidityUsd: liveDexPool?.liquidity?.usd,
          dexVolume24hUsd: liveDexPool?.volume?.h24,
          dexTxns24h: dexTxns24h > 0 ? dexTxns24h : undefined,
          dexUrl: liveDexPool?.url,
          dexPriceSource: hasLiveDex ? "aerodrome-base-live" : "onchain-nav-model",
          navPriceUpdatedAt: new Date(updatedAtNum * 1000).toISOString(),
          navPriceTimestamp: updatedAtNum,
          oracleAgeMinutes,
          isOracleStale,
          totalSupplyTokens,
          totalSupplySharesUI,
          uiMultiplier,
          onchainMarketCapUsd,
          change24hPct,
          source: hasLiveDex
            ? "base-mainnet+aerodrome-dex"
            : Object.keys(coinbaseApiMap).length > 0
            ? "coinbase-api+onchain"
            : "base-mainnet-onchain",
        };
      } catch {
        const totalSupplyTokens = fb.supply;
        const uiMultiplier = fb.mult;
        const totalSupplySharesUI = totalSupplyTokens * uiMultiplier;
        const hasLiveDex = Boolean(liveDexPool?.priceUsd && Number(liveDexPool.priceUsd) > 0);
        const dexPrice24_7 = hasLiveDex
          ? Number(Number(liveDexPool!.priceUsd).toFixed(2))
          : fb.price;
        const weekendGapPct = Number((((dexPrice24_7 - fb.price) / fb.price) * 100).toFixed(2));
        const weekendSignal: "BUY_DEX_DISCOUNT" | "SHORT_DEX_PREMIUM" | "FAIR_PARITY" =
          weekendGapPct <= -0.15
            ? "BUY_DEX_DISCOUNT"
            : weekendGapPct >= 0.15
            ? "SHORT_DEX_PREMIUM"
            : "FAIR_PARITY";

        return {
          ...meta,
          navPrice: fb.price,
          dexPrice24_7,
          weekendGapPct,
          weekendSignal,
          dexPairAddress: liveDexPool?.pairAddress,
          dexId: liveDexPool?.dexId === "aero" ? "Aerodrome Finance" : liveDexPool?.dexId,
          dexLiquidityUsd: liveDexPool?.liquidity?.usd,
          dexVolume24hUsd: liveDexPool?.volume?.h24,
          dexUrl: liveDexPool?.url,
          dexPriceSource: hasLiveDex ? "aerodrome-base-live" : "onchain-nav-model",
          // RPC unreachable: static snapshot, explicitly flagged as stale fallback (not live)
          navPriceUpdatedAt: new Date(0).toISOString(),
          navPriceTimestamp: 0,
          oracleAgeMinutes: -1,
          isOracleStale: true,
          totalSupplyTokens,
          totalSupplySharesUI,
          uiMultiplier,
          onchainMarketCapUsd: totalSupplyTokens * fb.price,
          change24hPct: liveDexPool?.priceChange?.h24 ?? 0,
          source: "fallback-snapshot",
        };
      }
    })
  );
  return liveStocks;
}

export async function GET(request: NextRequest) {
  const walletParam = request.nextUrl.searchParams.get("wallet");
  const liveStocks = await getMarket();

  // 3. Optional wallet B20 `balanceOfUI` & policy compliance inspection on Base Mainnet
  const walletBalances: Record<
    string,
    { rawTokens: number; sharesUI: number; usdValue: number; b20Authorized: boolean }
  > = {};

  // USDC balance on Base for the connected wallet (needed before buying)
  let walletUsdc: number | undefined;
  let walletError: string | undefined;

  if (walletParam && /^0x[a-fA-F0-9]{40}$/.test(walletParam)) {
    const walletAddr = walletParam as `0x${string}`;
    try {
      // Every balance in ONE multicall (was ~30 separate RPC calls)
      const perStock = liveStocks.flatMap((stock) => [
        { address: stock.b20Address, abi: B20_AND_CHAINLINK_ABI, functionName: "balanceOf" as const, args: [walletAddr] as const },
        { address: stock.b20Address, abi: B20_AND_CHAINLINK_ABI, functionName: "balanceOfUI" as const, args: [walletAddr] as const },
        { address: stock.b20Address, abi: B20_AND_CHAINLINK_ABI, functionName: "policyId" as const },
      ]);
      const usdcCall = {
        address: USDC_BASE,
        abi: B20_AND_CHAINLINK_ABI,
        functionName: "balanceOf" as const,
        args: [walletAddr] as const,
      };
      const results = await publicClient.multicall({ allowFailure: true, contracts: [...perStock, usdcCall] });
      const val = (i: number) => (results[i]?.status === "success" ? (results[i].result as bigint) : null);

      // Policy checks only where a policy is set (second, usually empty, multicall)
      const policyChecks = liveStocks
        .map((stock, i) => ({ stock, policy: val(i * 3 + 2) }))
        .filter((x) => x.policy !== null && x.policy > 0n);
      const authResults = policyChecks.length
        ? await publicClient.multicall({
            allowFailure: true,
            contracts: policyChecks.map((x) => ({
              address: x.stock.b20Address,
              abi: B20_AND_CHAINLINK_ABI,
              functionName: "isAuthorized" as const,
              args: [x.policy as bigint, walletAddr] as const,
            })),
          })
        : [];
      const authorized = new Map(
        policyChecks.map((x, i) => [x.stock.symbol, authResults[i]?.status === "success" ? Boolean(authResults[i].result) : false])
      );

      liveStocks.forEach((stock, i) => {
        const rawBal = val(i * 3);
        if (rawBal === null) return; // unknown, not zero: the client keeps what it had
        const rawBalUI = val(i * 3 + 1);
        const rawTokens = Number(rawBal) / Math.pow(10, stock.decimals);
        walletBalances[stock.symbol] = {
          rawTokens,
          sharesUI: rawBalUI !== null ? Number(rawBalUI) / Math.pow(10, stock.decimals) : rawTokens * stock.uiMultiplier,
          usdValue: rawTokens * stock.navPrice,
          b20Authorized: authorized.get(stock.symbol) ?? true,
        };
      });
      const usdcRaw = val(perStock.length);
      walletUsdc = usdcRaw !== null ? Number(usdcRaw) / 1e6 : undefined;
      if (Object.keys(walletBalances).length < liveStocks.length) walletError = "Some balances could not be read. Retry in a moment.";
    } catch {
      walletError = "Wallet balances are unavailable right now. Retry in a moment.";
    }
  }

  const totalBaseStocksTvlUsd = liveStocks.reduce((acc, s) => acc + s.onchainMarketCapUsd, 0);
  const totalBaseDexLiquidityUsd = liveStocks.reduce((acc, s) => acc + (s.dexLiquidityUsd ?? 0), 0);
  const totalBaseDexVolume24hUsd = liveStocks.reduce((acc, s) => acc + (s.dexVolume24hUsd ?? 0), 0);

  return NextResponse.json({
    ok: true,
    chainId: 8453,
    network: "Base Mainnet",
    oracleRegistry: COINBASE_ORACLE_REGISTRY_ADDRESS,
    fetchedAt: new Date().toISOString(),
    totalBaseStocksTvlUsd,
    totalBaseDexLiquidityUsd,
    totalBaseDexVolume24hUsd,
    count: liveStocks.length,
    stocks: liveStocks,
    walletBalances: Object.keys(walletBalances).length > 0 ? walletBalances : undefined,
    walletUsdc,
    walletError,
  });
}
