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
  "30D": { seconds: 30 * 86_400, gecko: "hour?aggregate=4&limit=180", maxRounds: 900 },
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
  const read = (ids: bigint[]) =>
    client.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({ address: feed, abi: FEED_ABI, functionName: "getRoundData" as const, args: [id] })),
    });
  const phaseBase = (latestId >> 64n) << 64n;
  const idsFrom = (start: bigint, count: number) => {
    const ids: bigint[] = [];
    for (let i = 0n; i < BigInt(count) && start - i > phaseBase; i++) ids.push(start - i);
    return ids;
  };

  // Newest 50 rounds first (usually enough for 24H); the rest in batches, stopping once older than sinceSec.
  const FIRST = 50;
  const results = [...(await read(idsFrom(latestId, Math.min(FIRST, maxRounds))))];
  const needMore = () => {
    const lastOk = [...results].reverse().find((r) => r.status === "success");
    return lastOk !== undefined && Number((lastOk.result as readonly bigint[])[3]) >= sinceSec;
  };
  if (maxRounds > FIRST && results.length === FIRST && needMore()) {
    const restIds = idsFrom(latestId - BigInt(FIRST), maxRounds - FIRST);
    for (let i = 0; i < restIds.length; i += 200) {
      const batch = await read(restIds.slice(i, i + 200));
      results.push(...batch);
      const lastOk = [...batch].reverse().find((r) => r.status === "success");
      if (!lastOk || Number((lastOk.result as readonly bigint[])[3]) < sinceSec) break;
    }
  }

  let roundFailures = 0;
  for (const r of results) {
    if (r.status !== "success") {
      roundFailures++;
      if (points.length === 0 || roundFailures > 3) throw new Error("Chainlink history RPC failed");
      continue;
    }
    const [, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
    const t = Number(updatedAt);
    if (t < sinceSec) break;
    if (answer > 0n) points.push([t, Number(answer) / 1e8]);
  }
  return points.reverse();
}

async function dexHistory(token: string, geckoPath: string) {
  const poolsRes = await fetch(`${GECKO}/tokens/${token}/pools?page=1`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(8000),
  });
  if (!poolsRes.ok) return { pool: null as string | null, points: [] as [number, number][], failed: true };
  const pools: { attributes: { address: string; reserve_in_usd: string } }[] = (await poolsRes.json())?.data ?? [];
  const ranked = [...pools]
    .sort((a, b) => (Number(b.attributes.reserve_in_usd) || 0) - (Number(a.attributes.reserve_in_usd) || 0))
    .slice(0, 3);

  const sep = geckoPath.includes("?") ? "&" : "?";
  // Deepest pool first; fall back to the next pool only if a pool answers with no candles.
  // Stop on HTTP errors (e.g. 429 rate limit) to avoid hammering the API.
  for (const candidate of ranked) {
    const pool = candidate.attributes.address;
    const ohlcRes = await fetch(`${GECKO}/pools/${pool}/ohlcv/${geckoPath}${sep}currency=usd&token=${token}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8000),
    });
    if (!ohlcRes.ok) return { pool, points: [] as [number, number][], failed: true };
    const list: number[][] = (await ohlcRes.json())?.data?.attributes?.ohlcv_list ?? [];
    // [timestamp, open, high, low, close, volume] — newest first
    const points = list.map((c) => [c[0], c[4]] as [number, number]).filter(([, p]) => p > 0).reverse();
    if (points.length > 0) return { pool, points, failed: false };
  }
  return { pool: ranked[0]?.attributes.address ?? null, points: [] as [number, number][], failed: false };
}

const inflightHistory = new Map<string, Promise<{ body: Record<string, unknown>; cacheable: boolean }>>();

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "";
  const tfParam = (request.nextUrl.searchParams.get("tf") || "7D").toUpperCase() as Timeframe;
  const tf: Timeframe = tfParam in TF ? tfParam : "7D";
  const stock = BASE_TOKENIZED_STOCKS.find((s) => s.symbol === symbol);
  if (!stock) return NextResponse.json({ ok: false, error: "Unknown symbol" }, { status: 400 });

  // only=nav skips the rate-limited DEX source (used by small sparklines); only=dex skips the Chainlink rounds
  // (hundreds of RPC reads) for callers that just need the 24/7 DEX price, like the news feed
  const only = request.nextUrl.searchParams.get("only");
  const navOnly = only === "nav";
  const dexOnly = only === "dex";
  const key = `${symbol}:${tf}:${navOnly ? "nav" : dexOnly ? "dex" : "all"}`;
  const hit = cache.get(key);
  // Charts change slowly: the CDN answers the same URL for 2 minutes and keeps it up to 15 while refreshing,
  // so switching stocks or many viewers of one chart don't each run the function (Chainlink rounds are costly)
  const CDN = { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=900" };
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body, { headers: CDN });

  let job = inflightHistory.get(key);
  if (!job) {
    const since = Math.floor(Date.now() / 1000) - TF[tf].seconds;
    job = (async () => {
      const [navRes, dexRes] = await Promise.allSettled([
        dexOnly ? Promise.resolve([] as [number, number][]) : chainlinkHistory(stock.chainlinkFeed, since, TF[tf].maxRounds),
        navOnly ? Promise.resolve({ pool: null, points: [] as [number, number][], failed: false }) : dexHistory(stock.b20Address, TF[tf].gecko),
      ]);

      const navFailed = !dexOnly && navRes.status === "rejected";
      const dexFailed = !navOnly && (dexRes.status === "rejected" || dexRes.value.failed);
      const navPoints = navRes.status === "fulfilled" ? navRes.value : [];
      const dexPoints = dexRes.status === "fulfilled" ? dexRes.value.points : [];
      const hasAnyData = navPoints.length > 0 || dexPoints.length > 0;
      const body = {
        ok: hasAnyData,
        symbol,
        tf,
        nav: navPoints,
        dex: dexPoints,
        dexPool: dexRes.status === "fulfilled" ? dexRes.value.pool : null,
        sources: {
          nav: `Chainlink feed ${stock.chainlinkFeed} (onchain rounds)`,
          dex: "GeckoTerminal OHLCV (deepest pool)",
        },
        fetchedAt: new Date().toISOString(),
      };
      const filled = hasAnyData && !navFailed && !dexFailed;
      if (filled) cache.set(key, { at: Date.now(), body });
      return { body, cacheable: filled };
    })().finally(() => inflightHistory.delete(key));
    inflightHistory.set(key, job);
  }
  const { body, cacheable } = await job;
  // An empty or rate-limited answer is not kept by the CDN, so the next request tries again
  return NextResponse.json(body, { headers: cacheable ? CDN : { "Cache-Control": "no-store" } });
}
