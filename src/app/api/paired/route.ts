import { NextResponse } from "next/server";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { cleanIndexName } from "@/lib/shareBasket";

/**
 * Third-party tokens that trade in a pool against one of the 10 tokenized stocks on Base (meme tokens and
 * other "stock-paired" tokens), read from DexScreener's public API. Read-only: MAXXAGENT never routes swaps
 * into these tokens. Dust pools, stablecoins, ETH/BTC, large-cap tokens and other wrappers of the same stocks
 * are left out, so the list shows only live pairs with real liquidity.
 */
export const maxDuration = 30;

const DEXSCREENER = "https://api.dexscreener.com/latest/dex/tokens/";
const CACHE_MS = 10 * 60_000;
const MIN_LIQ_USD = 10_000;
const MIN_AGE_DAYS = 7;
const MIN_VOL_IF_YOUNG = 1_000;
const MAX_ROWS = 40;

// Not "paired tokens": money, ETH/BTC, large established tokens, and other wrappers of the same stocks
const EXCLUDED_SYMBOLS = new Set(
  [
    "USDC",
    "USDBC",
    "USDT",
    "DAI",
    "EURC",
    "FRXUSD",
    "USDS",
    "GHO",
    "WETH",
    "ETH",
    "CBETH",
    "WSTETH",
    "WEETH",
    "RETH",
    "CBBTC",
    "WBTC",
    "TBTC",
    "LBTC",
    "LINK",
    "AAVE",
    "UNI",
    "AERO",
    "VIRTUAL",
  ].map((s) => s.toUpperCase()),
);
const WRAPPER_RE = /^(wt[A-Z]{1,6}|[A-Z]{1,6}c|[A-Z]{1,6}x|[A-Z]{1,6}on)$/; // wtNVDA, MUc, SKHYc, NVDAx, AAPLon
const UNFIT_RE =
  /dick|butt|anus|porn|nazi|hitler|cum\b|fuck|shit|nigg|rape|sex/i;

const STOCK_BY_ADDR = new Map(
  BASE_TOKENIZED_STOCKS.map((s) => [s.b20Address.toLowerCase(), s.symbol]),
);

type DsToken = { address?: string; name?: string; symbol?: string };
type DsPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: DsToken;
  quoteToken?: DsToken;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  priceUsd?: string;
  priceNative?: string;
  fdv?: number;
  pairCreatedAt?: number;
};

export type PairedToken = {
  token: { symbol: string; name: string; address: string };
  stock: string;
  dex: string;
  pairAddress: string;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange24hPct: number | null;
  priceUsd: number | null;
  fdvUsd: number | null;
  createdAt: number | null;
};

let cache: {
  at: number;
  rows: PairedToken[];
  scanned: number;
  failed: number;
} | null = null;

const isAddr = (a: unknown): a is string =>
  typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
// Uniswap v4 pools are identified by a 32-byte pool id, not a contract address
const isPoolId = (a: unknown): a is string =>
  typeof a === "string" && /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(a);
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

async function fetchPairs(address: string): Promise<DsPair[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
    const res = await fetch(DEXSCREENER + address, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    const body = (
      res && res.ok ? await res.json().catch(() => null) : null
    ) as { pairs?: DsPair[] } | null;
    if (body && Array.isArray(body.pairs)) return body.pairs;
  }
  return null;
}

async function load(): Promise<{
  rows: PairedToken[];
  scanned: number;
  failed: number;
}> {
  const byPair = new Map<string, PairedToken>();
  let scanned = 0;
  let failed = 0;
  // A few at a time: DexScreener refuses bursts of parallel requests
  const queue = [...BASE_TOKENIZED_STOCKS];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const pairs = await fetchPairs(s.b20Address);
        if (!pairs) failed++;
        for (const p of pairs ?? []) {
          if (p.chainId !== "base" || !isPoolId(p.pairAddress)) continue;
          scanned++;
          const baseIsStock =
            p.baseToken?.address?.toLowerCase() === s.b20Address.toLowerCase();
          const other = baseIsStock ? p.quoteToken : p.baseToken;
          if (
            !other ||
            !isAddr(other.address) ||
            STOCK_BY_ADDR.has(other.address.toLowerCase())
          )
            continue;
          const symbol = cleanIndexName(other.symbol, 16);
          const name = cleanIndexName(other.name, 40);
          if (
            !symbol ||
            EXCLUDED_SYMBOLS.has(symbol.toUpperCase()) ||
            WRAPPER_RE.test(symbol) ||
            UNFIT_RE.test(`${symbol} ${name}`)
          )
            continue;
          const liq = num(p.liquidity?.usd) ?? 0;
          const vol = num(p.volume?.h24) ?? 0;
          const created = num(p.pairCreatedAt);
          const ageDays = created ? (Date.now() - created) / 86_400_000 : null;
          if (liq < MIN_LIQ_USD) continue;
          // A young (or undated) pool must also show real trading, so a fresh pump with seeded liquidity is left out
          if (
            (ageDays === null || ageDays < MIN_AGE_DAYS) &&
            vol < MIN_VOL_IF_YOUNG
          )
            continue;
          const key = p.pairAddress.toLowerCase();
          if (byPair.has(key)) continue;
          // DexScreener prices the pair's base token. When the stock is the base, the paired token's USD price is
          // the stock's price divided by how many paired tokens one stock costs (priceNative)
          const basePrice = Number(p.priceUsd);
          const perStock = Number(p.priceNative);
          const price = baseIsStock ? (perStock > 0 ? basePrice / perStock : NaN) : basePrice;
          byPair.set(key, {
            token: { symbol, name: name || symbol, address: other.address },
            stock: s.symbol,
            dex: cleanIndexName(p.dexId, 20) || "dex",
            pairAddress: p.pairAddress,
            liquidityUsd: liq,
            volume24hUsd: vol,
            // the 24h change DexScreener reports is for the pair's base token: only meaningful when that is the paired token
            priceChange24hPct: baseIsStock ? null : num(p.priceChange?.h24),
            priceUsd: Number.isFinite(price) && price > 0 ? price : null,
            fdvUsd: !baseIsStock ? num(p.fdv) : null,
            createdAt: created,
          });
        }
      }
    }),
  );
  const rows = [...byPair.values()]
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
    .slice(0, MAX_ROWS);
  return { rows, scanned, failed };
}

export async function GET() {
  try {
    // An incomplete scan (some stocks unread) is retried after a minute instead of being kept for ten
    if (!cache || Date.now() - cache.at > (cache.failed ? 60_000 : CACHE_MS)) {
      const fresh = await load();
      // Keep the last good list when DexScreener answers with nothing (rate limit or outage)
      if (fresh.rows.length > 0 || !cache) cache = { at: Date.now(), ...fresh };
    }
    return NextResponse.json(
      {
        ok: true,
        updatedAt: new Date(cache.at).toISOString(),
        rules: {
          minLiquidityUsd: MIN_LIQ_USD,
          minAgeDays: MIN_AGE_DAYS,
          minVolumeIfYoungUsd: MIN_VOL_IF_YOUNG,
        },
        poolsScanned: cache.scanned,
        tokens: cache.rows,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Paired tokens are unavailable right now." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
