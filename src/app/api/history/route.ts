import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, parseAbi } from "viem";
import { baseTransport } from "@/lib/rpc";
import { base } from "viem/chains";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";

/**
 * Real price history for one tokenized stock:
 *  - nav: Chainlink total-return feed rounds read onchain (getRoundData), 24/5
 *  - dex: DEX OHLCV closes from GeckoTerminal for the deepest pool, 24/7
 * Nothing is synthesized: if a source is unavailable its series is empty.
 */
type Timeframe = "24H" | "7D" | "30D";
const TF: Record<Timeframe, { seconds: number; gecko: string; maxRounds: number }> = {
  "24H": { seconds: 86_400, gecko: "minute?aggregate=15&limit=96", maxRounds: 150 },
  "7D": { seconds: 7 * 86_400, gecko: "hour?aggregate=1&limit=168", maxRounds: 300 },
  "30D": { seconds: 30 * 86_400, gecko: "hour?aggregate=4&limit=180", maxRounds: 400 },
};

const FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const client = createPublicClient({
  chain: base,
  transport: baseTransport({ timeout: 10000 }),
  batch: { multicall: true },
});

const cache = new Map<string, { at: number; body: unknown }>();
const TTL_MS = 5 * 60 * 1000;
const GECKO = "https://api.geckoterminal.com/api/v2/networks/base";

async function chainlinkHistory(feed: `0x${string}`, sinceSec: number, maxRounds: number) {
  const points: [number, number][] = [];
  const [latestId] = await client.readContract({ address: feed, abi: FEED_ABI, functionName: "latestRoundData" });
  let cursor = latestId;
  const batchSize = 50n;
  let reads = 0;
  while (reads < maxRounds) {
    const ids: bigint[] = [];
    for (let i = 0n; i < batchSize && cursor - i > 0n; i++) ids.push(cursor - i);
    if (ids.length === 0) break;
    const results = await client.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({ address: feed, abi: FEED_ABI, functionName: "getRoundData" as const, args: [id] })),
    });
    reads += ids.length;
    let reachedStart = false;
    for (const r of results) {
      if (r.status !== "success") {
        reachedStart = true; // phase boundary / missing round
        break;
      }
      const [, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
      const t = Number(updatedAt);
      if (t < sinceSec) {
        reachedStart = true;
        break;
      }
      if (answer > 0n) points.push([t, Number(answer) / 1e8]);
    }
    if (reachedStart) break;
    cursor -= batchSize;
  }
  return points.reverse();
}

async function dexHistory(token: string, geckoPath: string) {
  const poolsRes = await fetch(`${GECKO}/tokens/${token}/pools?page=1`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!poolsRes.ok) return { pool: null as string | null, points: [] as [number, number][] };
  const pools: { attributes: { address: string; reserve_in_usd: string } }[] = (await poolsRes.json())?.data ?? [];
  const ranked = [...pools]
    .sort((a, b) => Number(b.attributes.reserve_in_usd) - Number(a.attributes.reserve_in_usd))
    .slice(0, 3);

  const sep = geckoPath.includes("?") ? "&" : "?";
  // Deepest pool first; fall back to the next pool only if a pool answers with no candles.
  // Stop on HTTP errors (e.g. 429 rate limit) to avoid hammering the API.
  for (const candidate of ranked) {
    const pool = candidate.attributes.address;
    const ohlcRes = await fetch(`${GECKO}/pools/${pool}/ohlcv/${geckoPath}${sep}currency=usd&token=${token}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!ohlcRes.ok) return { pool, points: [] as [number, number][] };
    const list: number[][] = (await ohlcRes.json())?.data?.attributes?.ohlcv_list ?? [];
    // [timestamp, open, high, low, close, volume] — newest first
    const points = list.map((c) => [c[0], c[4]] as [number, number]).filter(([, p]) => p > 0).reverse();
    if (points.length > 0) return { pool, points };
  }
  return { pool: ranked[0]?.attributes.address ?? null, points: [] as [number, number][] };
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "";
  const tfParam = (request.nextUrl.searchParams.get("tf") || "7D").toUpperCase() as Timeframe;
  const tf: Timeframe = tfParam in TF ? tfParam : "7D";
  const stock = BASE_TOKENIZED_STOCKS.find((s) => s.symbol === symbol);
  if (!stock) return NextResponse.json({ ok: false, error: "Unknown symbol" }, { status: 400 });

  // only=nav skips the rate-limited DEX source (used by small sparklines)
  const navOnly = request.nextUrl.searchParams.get("only") === "nav";
  const key = `${symbol}:${tf}:${navOnly ? "nav" : "all"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body);

  const since = Math.floor(Date.now() / 1000) - TF[tf].seconds;
  const [navRes, dexRes] = await Promise.allSettled([
    chainlinkHistory(stock.chainlinkFeed, since, TF[tf].maxRounds),
    navOnly ? Promise.resolve({ pool: null, points: [] as [number, number][] }) : dexHistory(stock.b20Address, TF[tf].gecko),
  ]);

  const body = {
    ok: true,
    symbol,
    tf,
    nav: navRes.status === "fulfilled" ? navRes.value : [],
    dex: dexRes.status === "fulfilled" ? dexRes.value.points : [],
    dexPool: dexRes.status === "fulfilled" ? dexRes.value.pool : null,
    sources: {
      nav: `Chainlink feed ${stock.chainlinkFeed} (onchain rounds)`,
      dex: "GeckoTerminal OHLCV (deepest pool)",
    },
    fetchedAt: new Date().toISOString(),
  };
  if (body.nav.length > 0 || body.dex.length > 0) cache.set(key, { at: Date.now(), body });
  return NextResponse.json(body);
}
