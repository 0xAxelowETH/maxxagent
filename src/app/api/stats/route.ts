import { NextRequest, NextResponse, after } from "next/server";
import { createPublicClient, decodeAbiParameters, decodeFunctionData, toHex } from "viem";
import { base } from "viem/chains";
import { entryPoint06Abi, entryPoint07Abi, entryPoint06Address, entryPoint07Address, entryPoint08Address } from "viem/account-abstraction";
import { Attribution } from "ox/erc8021";
import { baseTransport, redactSecrets } from "@/lib/rpc";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { indexCount, readIndexes } from "@/lib/indexRegistry";
import { matchIndexBuys } from "@/lib/indexMatch";
import { kvEnabled, kvGetJson, kvSetJson } from "@/lib/kv";

/**
 * Public traction stats for MAXXAGENT, computed only from onchain data (anyone can verify them):
 *  - every swap built by MAXXAGENT goes through the KyberSwap router with source "maxxagent", and the
 *    router emits ClientData({"Source":"maxxagent","AmountInUSD":…,"AmountOutUSD":…}) in that tx
 *  - the router's Swapped event in the same tx gives the wallet, tokens and amounts
 *  - the tx input (or the ERC-4337 UserOperation callData) shows whether the Builder Code is attached
 * The team's own test wallet is excluded so the numbers reflect real users.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5" as const;
const CLIENT_DATA_TOPIC = "0x095e66fa4dd6a6f7b43fb8444a7bd0edb870508c7abf639bc216efb0bcff9779"; // ClientData(bytes)
const SWAPPED_TOPIC = "0xd6d4f5681c246c9f42c203e287975af1601f8df8035a9251f79aab5c8f09e2f8"; // Swapped(address,address,address,address,uint256,uint256)
const SOURCE_TAG = toHex('"Source":"maxxagent"').slice(2);
// First swap built by MAXXAGENT (2026-11-07). Nothing to scan before it.
const START_BLOCK = 54_150_000n;
const CHUNK = process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL ? 100_000n : 45_000n;
const CONCURRENCY = 2;
const BUILDER_CODE = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
// Team test wallet(s): excluded from public stats (comma-separated extra addresses via STATS_EXCLUDE)
const EXCLUDED = new Set(
  ["0xD986C711F575C71dA22Bd08742b9DB2091Ba9e33", ...(process.env.STATS_EXCLUDE || "").split(",")].map((a) => a.trim().toLowerCase()).filter(Boolean)
);
const ENTRY_POINTS = new Set([entryPoint06Address, entryPoint07Address, entryPoint08Address].map((a) => a.toLowerCase()));
const STOCKS = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.b20Address.toLowerCase(), s]));

const client = createPublicClient({ chain: base, transport: baseTransport({ timeout: 12_000 }) });

interface Trade {
  hash: string;
  logIndex: number;
  block: bigint;
  /** unix seconds, from the block itself (block time is not constant on Base) */
  time: number;
  wallet: string;
  side: "buy" | "sell";
  symbol: string;
  usd: number;
  attributed: boolean;
}
interface StatsState {
  scannedTo: bigint;
  trades: Map<string, Trade>;
  at: number;
  since: number;
}
let state: StatsState | null = null;
const KV_STATE_KEY = "stats:state:v1";
const RESPONSE_BUDGET_MS = 45_000;
let inflight: Promise<StatsState> | null = null;

interface SerializedStats {
  scannedTo: string;
  at: number;
  since: number;
  trades: (Omit<Trade, "block"> & { block: string })[];
}

async function loadPersistedState(): Promise<StatsState | null> {
  if (!kvEnabled()) return null;
  try {
    const saved = await kvGetJson<SerializedStats>(KV_STATE_KEY);
    if (!saved || !saved.scannedTo || !Array.isArray(saved.trades) || !Number.isFinite(saved.since)) return null;
    const trades = new Map<string, Trade>();
    for (const t of saved.trades) {
      trades.set(`${t.hash}:${t.logIndex}`, { ...t, block: BigInt(t.block) });
    }
    return { scannedTo: BigInt(saved.scannedTo), trades, at: Number.isFinite(saved.at) ? saved.at : Date.now(), since: saved.since };
  } catch {
    return null;
  }
}

async function savePersistedState(s: StatsState): Promise<void> {
  if (!kvEnabled()) return;
  const payload: SerializedStats = {
    scannedTo: s.scannedTo.toString(),
    at: s.at,
    since: s.since,
    trades: [...s.trades.values()].map((t) => ({ ...t, block: t.block.toString() })),
  };
  await kvSetJson(KV_STATE_KEY, payload).catch(() => {});
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw last;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

const codesOf = (data: `0x${string}`) => {
  try {
    return Attribution.fromData(data)?.codes ?? [];
  } catch {
    return [] as string[];
  }
};

/** Where indexers read the Builder Code: tx input (EOA / EIP-7702) or the sender's UserOperation callData (ERC-4337). */
async function isAttributed(hash: `0x${string}`, wallet: string): Promise<boolean> {
  const tx = await withRetry(() => client.getTransaction({ hash }));
  if (tx.to && ENTRY_POINTS.has(tx.to.toLowerCase())) {
    for (const abi of [entryPoint07Abi, entryPoint06Abi]) {
      try {
        const { functionName, args } = decodeFunctionData({ abi, data: tx.input });
        if (functionName !== "handleOps") continue;
        const ops = args[0] as readonly { sender: string; callData: `0x${string}` }[];
        return ops.some((o) => o.sender.toLowerCase() === wallet && codesOf(o.callData).includes(BUILDER_CODE));
      } catch {}
    }
    return false;
  }
  return codesOf(tx.input).includes(BUILDER_CODE);
}

async function readTrades(hash: `0x${string}`, entries: { logIndex: number; usd: number }[]): Promise<Trade[]> {
  const r = await withRetry(() => client.getTransactionReceipt({ hash }));
  if (r.status !== "success") return [];
  const swappedLogs = r.logs.filter((l) => l.address.toLowerCase() === ROUTER.toLowerCase() && l.topics[0] === SWAPPED_TOPIC);
  if (swappedLogs.length === 0) return [];
  const block = await withRetry(() => client.getBlock({ blockNumber: r.blockNumber }));
  const attrCache = new Map<string, boolean>();
  const out: Trade[] = [];
  // Global minimum-distance pairing between stock Swapped logs and MAXXAGENT ClientData entries
  // so non-MAXXAGENT swaps in the same tx cannot steal a ClientData entry or emit phantom $0 trades.
  const candidates: {
    swapIdx: number;
    swapLogIdx: number;
    wallet: string;
    side: "buy" | "sell";
    symbol: string;
  }[] = [];
  for (let i = 0; i < swappedLogs.length; i++) {
    const log = swappedLogs[i];
    let decoded: readonly [string, string, string, string, bigint, bigint];
    try {
      decoded = decodeAbiParameters(
        ["address", "address", "address", "address", "uint256", "uint256"].map((type) => ({ type })),
        log.data
      ) as readonly [string, string, string, string, bigint, bigint];
    } catch {
      continue;
    }
    const [sender, src, dst] = decoded;
    const s = src.toLowerCase();
    const d = dst.toLowerCase();
    const side = STOCKS.has(d) && (s === USDC || s === NATIVE_ETH) ? "buy" : STOCKS.has(s) && d === USDC ? "sell" : null;
    if (!side) continue;
    const wallet = sender.toLowerCase();
    if (!attrCache.has(wallet)) {
      attrCache.set(wallet, await isAttributed(hash, wallet).catch(() => false));
    }
    candidates.push({ swapIdx: i, swapLogIdx: log.logIndex ?? i, wallet, side, symbol: STOCKS.get(side === "buy" ? d : s)!.symbol });
  }
  const pairs: { ci: number; ei: number; dist: number }[] = [];
  for (let ci = 0; ci < candidates.length; ci++) {
    for (let ei = 0; ei < entries.length; ei++) {
      pairs.push({ ci, ei, dist: Math.abs(entries[ei].logIndex - candidates[ci].swapLogIdx) });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist);
  const usedSwaps = new Set<number>();
  const usedEntries = new Set<number>();
  const matchForCandidate = new Map<number, number>();
  for (const p of pairs) {
    if (usedSwaps.has(p.ci) || usedEntries.has(p.ei)) continue;
    usedSwaps.add(p.ci);
    usedEntries.add(p.ei);
    matchForCandidate.set(p.ci, p.ei);
  }
  for (let ci = 0; ci < candidates.length; ci++) {
    const ei = matchForCandidate.get(ci);
    if (ei === undefined) continue;
    const c = candidates[ci];
    out.push({
      hash,
      logIndex: c.swapLogIdx,
      block: r.blockNumber,
      time: Number(block.timestamp),
      wallet: c.wallet,
      side: c.side,
      symbol: c.symbol,
      usd: entries[ei].usd,
      attributed: attrCache.get(c.wallet)!,
    });
  }
  return out;
}

type RawLog = { transactionHash: `0x${string}`; blockNumber?: string; logIndex?: string; data: string };

async function fetchLogsAdaptive(a: bigint, b: bigint): Promise<RawLog[]> {
  try {
    return (await client.request({
      method: "eth_getLogs",
      params: [{ address: ROUTER, topics: [CLIENT_DATA_TOPIC], fromBlock: toHex(a), toBlock: toHex(b) }],
    })) as unknown as RawLog[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (b - a <= 1_000n) {
      return (await withRetry(
        () =>
          client.request({
            method: "eth_getLogs",
            params: [{ address: ROUTER, topics: [CLIENT_DATA_TOPIC], fromBlock: toHex(a), toBlock: toHex(b) }],
          }) as Promise<unknown>,
        2
      )) as RawLog[];
    }
    if (!/limit|range|exceed|more than|too large|response size|timeout/i.test(msg)) {
      try {
        return (await withRetry(
          () =>
            client.request({
              method: "eth_getLogs",
              params: [{ address: ROUTER, topics: [CLIENT_DATA_TOPIC], fromBlock: toHex(a), toBlock: toHex(b) }],
            }) as Promise<unknown>,
          2
        )) as RawLog[];
      } catch {}
    }
    const mid = a + (b - a) / 2n;
    const left = await fetchLogsAdaptive(a, mid);
    const right = await fetchLogsAdaptive(mid + 1n, b);
    return [...left, ...right];
  }
}

async function refresh(): Promise<StatsState> {
  const persisted = await loadPersistedState();
  if (persisted && (!state || persisted.scannedTo >= state.scannedTo)) {
    const merged = new Map(state?.trades ?? []);
    for (const [k, v] of persisted.trades) merged.set(k, v);
    const prevAt = persisted.at > 0 ? persisted.at : state?.at ?? 0;
    state = { scannedTo: persisted.scannedTo, trades: merged, at: prevAt, since: persisted.since };
  }
  const latest = await client.getBlockNumber();
  const since = state?.since ?? Number((await withRetry(() => client.getBlock({ blockNumber: START_BLOCK }))).timestamp);
  const trades = new Map(state?.trades ?? []);
  const seenHashes = new Set([...trades.values()].map((t) => t.hash));
  const from = state ? state.scannedTo + 1n : START_BLOCK;
  const ranges: [bigint, bigint][] = [];
  for (let a = from; a <= latest; a += CHUNK) ranges.push([a, a + CHUNK - 1n > latest ? latest : a + CHUNK - 1n]);

  let currentScannedTo = state ? state.scannedTo : START_BLOCK - 1n;
  let incomplete = false;
  // Scan chronologically in batches so cold starts checkpoint progress to KV before hitting Vercel's 60s limit
  const BATCH_SIZE = CONCURRENCY * 3;
  for (let startIdx = 0; startIdx < ranges.length; startIdx += BATCH_SIZE) {
    const batch = ranges.slice(startIdx, startIdx + BATCH_SIZE);
    const found = await pool(batch, CONCURRENCY, ([a, b]) => fetchLogsAdaptive(a, b));
    const ours = new Map<string, { block: bigint; entries: { logIndex: number; usd: number }[] }>();
    for (const logs of found) {
      for (const l of logs) {
        if (!l.data.toLowerCase().includes(SOURCE_TAG)) continue;
        let usd = 0;
        let isMaxxagent = false;
        try {
          const [bytes] = decodeAbiParameters([{ type: "bytes" }], l.data as `0x${string}`);
          const json = JSON.parse(Buffer.from(bytes.slice(2), "hex").toString("utf8"));
          if (json?.Source === "maxxagent") {
            isMaxxagent = true;
            const parsedUsd = Number(json.AmountInUSD);
            usd = Number.isFinite(parsedUsd) && parsedUsd >= 0 && parsedUsd <= 1_000_000 ? parsedUsd : 0;
          }
        } catch {}
        if (!isMaxxagent) continue;
        const cur = ours.get(l.transactionHash) ?? {
          block: l.blockNumber ? BigInt(l.blockNumber) : latest,
          entries: [],
        };
        cur.entries.push({ logIndex: l.logIndex ? Number(l.logIndex) : cur.entries.length, usd });
        ours.set(l.transactionHash, cur);
      }
    }
    const fresh = [...ours.entries()].filter(([h]) => !seenHashes.has(h));
    let failedMinBlock: bigint | null = null;
    const read = await pool(fresh, 4, ([h, info]) =>
      readTrades(h as `0x${string}`, info.entries.sort((a, b) => a.logIndex - b.logIndex)).catch(() => {
        failedMinBlock = failedMinBlock === null || info.block < failedMinBlock ? info.block : failedMinBlock;
        return [] as Trade[];
      })
    );
    for (const list of read) {
      for (const t of list) {
        trades.set(`${t.hash}:${t.logIndex}`, t);
        seenHashes.add(t.hash);
      }
    }
    const batchEnd = batch[batch.length - 1][1];
    currentScannedTo = failedMinBlock !== null ? failedMinBlock - 1n : batchEnd;
    // Mark checkpoint `at: 0` so intermediate/incomplete progress is never mistaken for a fresh completed scan
    const checkpoint: StatsState = { scannedTo: currentScannedTo, trades, at: 0, since };
    if (!state) state = checkpoint;
    await savePersistedState(checkpoint);
    if (failedMinBlock !== null) {
      incomplete = true;
      break;
    }
  }

  const finalState: StatsState = { scannedTo: currentScannedTo, trades, at: incomplete ? 0 : Date.now(), since };
  await savePersistedState(finalState);
  return finalState;
}

export async function GET(request: NextRequest) {
  // Dev only: ?team=1 includes the team test wallet, to check the pipeline against real trades
  const includeTeam = process.env.NODE_ENV !== "production" && request.nextUrl.searchParams.has("team");
  try {
    if (!state) state = await loadPersistedState();
    const isIncomplete = Boolean(state && state.at === 0);
    const servedStale = Boolean(state && state.at > 0 && Date.now() - state.at > 60_000);
    if (!state || isIncomplete || servedStale) {
      if (!inflight) inflight = refresh().finally(() => (inflight = null));
      const job = inflight;
      // Keep the refresh alive after the response (serverless would freeze it) and store its result
      const keep = () => after(() => job.then((s) => void (state = s), () => undefined));
      if (state && state.at > 0) {
        // Serve the previous complete numbers now; the refresh lands for the next visitor
        keep();
      } else {
        // First scan or resumed incomplete checkpoint: wait up to 45s instead of caching truncated totals on CDN
        const done = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), RESPONSE_BUDGET_MS))]);
        if (!done) {
          keep();
          return NextResponse.json(
            { ok: false, loading: true, error: "Stats are loading. This page retries by itself." },
            { status: 202, headers: { "Cache-Control": "no-store" } }
          );
        }
        state = done;
      }
    }
    const current = state!;

    const all = [...current.trades.values()]
      .filter((t) => includeTeam || !EXCLUDED.has(t.wallet))
      .sort((a, b) => Number(b.block - a.block) || b.logIndex - a.logIndex);
    const perStock = new Map<string, { symbol: string; trades: number; volumeUsd: number }>();
    const daily = new Map<string, { date: string; trades: number; volumeUsd: number; wallets: Set<string> }>();
    for (const t of all) {
      const ps = perStock.get(t.symbol) || { symbol: t.symbol, trades: 0, volumeUsd: 0 };
      ps.trades++;
      ps.volumeUsd += t.usd;
      perStock.set(t.symbol, ps);
      const date = new Date(t.time * 1000).toISOString().slice(0, 10);
      const dd = daily.get(date) || { date, trades: 0, volumeUsd: 0, wallets: new Set<string>() };
      dd.trades++;
      dd.volumeUsd += t.usd;
      dd.wallets.add(t.wallet);
      daily.set(date, dd);
    }
    // Buys of published indexes, recognised by their shape (same wallet, the index's stocks and weights)
    let indexBuysFailed = false;
    const indexBuys = await (async () => {
      const total = await indexCount();
      const ids = Array.from({ length: total }, (_, i) => total - 1 - i);
      return matchIndexBuys(all, await readIndexes(ids));
    })().catch(() => {
      indexBuysFailed = true;
      return [];
    });
    const body = {
      ok: true,
      builderCode: BUILDER_CODE,
      since: new Date(current.since * 1000).toISOString(),
      updatedAt: new Date(current.at).toISOString(),
      excludesTeamTestWallet: !includeTeam,
      totals: {
        trades: all.length,
        buys: all.filter((t) => t.side === "buy").length,
        sells: all.filter((t) => t.side === "sell").length,
        volumeUsd: all.reduce((a, t) => a + t.usd, 0),
        wallets: new Set(all.map((t) => t.wallet)).size,
        attributed: all.filter((t) => t.attributed).length,
      },
      indexBuys,
      perStock: [...perStock.values()].sort((a, b) => b.volumeUsd - a.volumeUsd),
      daily: [...daily.values()].map((d) => ({ date: d.date, trades: d.trades, volumeUsd: d.volumeUsd, wallets: d.wallets.size })).sort((a, b) => (a.date < b.date ? 1 : -1)),
      recent: all.slice(0, 25).map((t) => ({
        time: new Date(t.time * 1000).toISOString(),
        wallet: `${t.wallet.slice(0, 6)}…${t.wallet.slice(-4)}`,
        side: t.side,
        symbol: t.symbol,
        usd: t.usd,
        hash: t.hash,
        logIndex: t.logIndex,
        attributed: t.attributed,
      })),
    };
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": servedStale || current.at === 0 || indexBuysFailed ? "no-store" : "public, s-maxage=120, stale-while-revalidate=600",
      },
    });
  } catch (e) {
    console.error("stats error", redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200));
    return NextResponse.json(
      { ok: false, error: "Stats are unavailable right now. Please retry in a moment." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
