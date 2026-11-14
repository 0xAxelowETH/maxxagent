import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, decodeAbiParameters, decodeFunctionData, toHex } from "viem";
import { base } from "viem/chains";
import { entryPoint06Abi, entryPoint07Abi, entryPoint06Address, entryPoint07Address, entryPoint08Address } from "viem/account-abstraction";
import { Attribution } from "ox/erc8021";
import { baseTransport, redactSecrets } from "@/lib/rpc";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { indexCount, readIndexes } from "@/lib/indexRegistry";
import { matchIndexBuys } from "@/lib/indexMatch";

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
const CHUNK = process.env.BASE_RPC_URL ? 100_000n : 45_000n;
const CONCURRENCY = 3;
const BUILDER_CODE = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
// Team test wallet(s): excluded from public stats (comma-separated extra addresses via STATS_EXCLUDE)
const EXCLUDED = new Set(
  ["0xD986C711F575C71dA22Bd08742b9DB2091Ba9e33", ...(process.env.STATS_EXCLUDE || "").split(",")].map((a) => a.trim().toLowerCase()).filter(Boolean)
);
const ENTRY_POINTS = new Set([entryPoint06Address, entryPoint07Address, entryPoint08Address].map((a) => a.toLowerCase()));
const STOCKS = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.b20Address.toLowerCase(), s]));

const client = createPublicClient({ chain: base, transport: baseTransport({ timeout: 30_000 }) });

interface Trade {
  hash: string;
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
let inflight: Promise<StatsState> | null = null;

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
        const op = (args[0] as readonly { sender: string; callData: `0x${string}` }[]).find((o) => o.sender.toLowerCase() === wallet);
        return op ? codesOf(op.callData).includes(BUILDER_CODE) : false;
      } catch {}
    }
    return false;
  }
  return codesOf(tx.input).includes(BUILDER_CODE);
}

async function readTrade(hash: `0x${string}`, usdIn: number): Promise<Trade | null> {
  const r = await withRetry(() => client.getTransactionReceipt({ hash }));
  if (r.status !== "success") return null;
  const log = r.logs.find((l) => l.address.toLowerCase() === ROUTER.toLowerCase() && l.topics[0] === SWAPPED_TOPIC);
  if (!log) return null;
  const [sender, src, dst] = decodeAbiParameters(
    ["address", "address", "address", "address", "uint256", "uint256"].map((type) => ({ type })),
    log.data
  ) as readonly [string, string, string, string, bigint, bigint];
  const s = src.toLowerCase();
  const d = dst.toLowerCase();
  const side = STOCKS.has(d) && (s === USDC || s === NATIVE_ETH) ? "buy" : STOCKS.has(s) && d === USDC ? "sell" : null;
  if (!side) return null; // not a stock trade
  const wallet = sender.toLowerCase();
  const block = await withRetry(() => client.getBlock({ blockNumber: r.blockNumber }));
  return {
    hash,
    block: r.blockNumber,
    time: Number(block.timestamp),
    wallet,
    side,
    symbol: STOCKS.get(side === "buy" ? d : s)!.symbol,
    usd: usdIn,
    attributed: await isAttributed(hash, wallet).catch(() => false),
  };
}

async function refresh(): Promise<StatsState> {
  const latest = await client.getBlockNumber();
  const since = state?.since ?? Number((await withRetry(() => client.getBlock({ blockNumber: START_BLOCK }))).timestamp);
  const trades = new Map(state?.trades ?? []);
  const from = state ? state.scannedTo + 1n : START_BLOCK;
  const ranges: [bigint, bigint][] = [];
  for (let a = from; a <= latest; a += CHUNK) ranges.push([a, a + CHUNK - 1n > latest ? latest : a + CHUNK - 1n]);

  // ClientData logs of the router; keep only MAXXAGENT ones (filtered by the JSON source tag)
  const found = await pool(ranges, CONCURRENCY, ([a, b]) =>
    withRetry(() =>
      client.request({
        method: "eth_getLogs",
        params: [{ address: ROUTER, topics: [CLIENT_DATA_TOPIC], fromBlock: toHex(a), toBlock: toHex(b) }],
      })
    )
  );
  const ours = new Map<string, number>();
  for (const logs of found as unknown as { transactionHash: `0x${string}`; data: string }[][]) {
    for (const l of logs) {
      if (!l.data.includes(SOURCE_TAG)) continue;
      let usd = 0;
      try {
        const [bytes] = decodeAbiParameters([{ type: "bytes" }], l.data as `0x${string}`);
        const json = JSON.parse(Buffer.from(bytes.slice(2), "hex").toString("utf8"));
        usd = Number(json.AmountInUSD) || 0;
      } catch {}
      ours.set(l.transactionHash, usd);
    }
  }
  const fresh = [...ours.entries()].filter(([h]) => !trades.has(h));
  const read = await pool(fresh, 4, ([h, usd]) => readTrade(h as `0x${string}`, usd).catch(() => null));
  for (const t of read) if (t) trades.set(t.hash, t);
  return { scannedTo: latest, trades, at: Date.now(), since };
}

export async function GET(request: NextRequest) {
  // Dev only: ?team=1 includes the team test wallet, to check the pipeline against real trades
  const includeTeam = process.env.NODE_ENV !== "production" && request.nextUrl.searchParams.has("team");
  try {
    if (!state || Date.now() - state.at > 60_000) {
      if (!inflight) inflight = refresh().finally(() => (inflight = null));
      state = await inflight;
    }
    const current = state;

    const all = [...current.trades.values()].filter((t) => includeTeam || !EXCLUDED.has(t.wallet)).sort((a, b) => Number(b.block - a.block));
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
    const indexBuys = await (async () => {
      const total = await indexCount();
      const ids = Array.from({ length: Math.min(total, 60) }, (_, i) => total - 1 - i);
      return matchIndexBuys(all, await readIndexes(ids));
    })().catch(() => []);
    const body = {
      ok: true,
      builderCode: BUILDER_CODE,
      since: new Date(current.since * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
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
        attributed: t.attributed,
      })),
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } });
  } catch (e) {
    console.error("stats error", redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200));
    return NextResponse.json({ ok: false, error: "Stats are unavailable right now. Please retry in a moment." }, { status: 502 });
  }
}
