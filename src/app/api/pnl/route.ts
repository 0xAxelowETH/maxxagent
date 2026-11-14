import { NextRequest, NextResponse, after } from "next/server";
import { createPublicClient, decodeEventLog, parseAbi, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { baseTransport, redactSecrets } from "@/lib/rpc";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";

/**
 * Profit & loss for a wallet's Coinbase B20 stock positions, rebuilt from its onchain history.
 *
 * Cost basis = average cost:
 *  - stock received in a tx where the wallet paid USDC  -> cost = that USDC (exact)
 *  - stock received without USDC (paid in ETH, sent from another wallet, minted) -> cost = Chainlink NAV
 *    at that block (`estimated`)
 *  - stock sent out -> position reduced at average cost; realized P/L = USDC received in the same tx
 *    (or NAV at that block if no USDC came back, e.g. sold for ETH or moved away; `estimated`)
 * In a batched tx the wallet's transfers are paired in log order (USDC out -> stock in; stock out -> USDC in).
 *
 * History is scanned newest-first: old block ranges are slow on RPCs, and most positions are recent.
 * The scan window grows backwards until the wallet held none of the stocks at the window start (then
 * the cost basis is exact) or the time budget runs out (then the opening balance is valued at the NAV of
 * the window start, `estimated`). Current value / unrealized P/L are computed client-side from live data.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ETH_USD_FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70" as const; // Chainlink ETH / USD on Base
// First Coinbase B20 stock supply on Base (NVDAc, 2026-08-12): nothing exists before this
const START_BLOCK = 49_870_000n;
// Dedicated RPCs (CDP) accept 100k-block getLogs ranges; the public fallback caps at 50k
const CHUNK = process.env.BASE_RPC_URL ? 100_000n : 45_000n;
// ~3 days at Base's 0.2s block time (it was 2s until late Oct 2026, so older ranges cover more time)
const FIRST_WINDOW = 1_300_000n;
const CONCURRENCY = 4; // more triggers the RPC's rate limit
const TIME_BUDGET_MS = 25_000;
// Respond by then whatever happens (Vercel stops the function at 60s and the user would get a 504)
const RESPONSE_BUDGET_MS = 45_000;
const MAX_TXS = 400;
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_PARALLEL_SCANS = 3;

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function balanceOf(address) view returns (uint256)",
]);
const client = createPublicClient({ chain: base, transport: baseTransport({ timeout: 10_000 }), batch: { multicall: true } });

const STOCKS = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.b20Address.toLowerCase(), s]));
const STOCK_ADDRESSES = BASE_TOKENIZED_STOCKS.map((s) => s.b20Address);

type Move = { token: string; amount: bigint; dir: 1 | -1; logIndex: number };
/** ethValue: ETH the wallet itself sent with the tx (a buy paid in ETH has no USDC transfer) */
type TxSummary = { hash: string; block: bigint; moves: Move[]; ethValue?: bigint };
interface WalletHistory {
  /** history is complete from this block (inclusive) to scannedTo */
  scannedFrom: bigint;
  scannedTo: bigint;
  /** raw balances held at scannedFrom - 1 (non-zero = position opened before the window) */
  opening: Map<string, bigint>;
  txs: Map<string, TxSummary>;
  at: number;
}
const cache = new Map<string, WalletHistory>();
const inflight = new Map<string, Promise<WalletHistory>>();
const navCache = new Map<string, number>();

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1))); // rate-limit backoff
    }
  }
  throw last;
}

/**
 * Stock Transfer logs in/out of the wallet for [from, to], scanned in chunks NEWEST FIRST.
 * Stops starting new chunks after `deadline`. Only the contiguous run of completed chunks from `to`
 * backwards counts, so the history it returns has no gaps: [coveredFrom, to].
 */
async function scanRange(wallet: `0x${string}`, from: bigint, to: bigint, deadline = Infinity) {
  const chunks: [bigint, bigint][] = [];
  for (let e = to; e >= from; e -= CHUNK) chunks.push([e - CHUNK + 1n < from ? from : e - CHUNK + 1n, e]);
  const found: (`0x${string}`[] | null)[] = chunks.map(() => null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY / 2, chunks.length) }, async () => {
      while (next < chunks.length && Date.now() < deadline) {
        const i = next++;
        const [a, b] = chunks[i];
        const [ins, outs] = await Promise.all(
          [{ to: wallet }, { from: wallet }].map((args) =>
            withRetry(() => client.getLogs({ address: STOCK_ADDRESSES, event: TRANSFER, args, fromBlock: a, toBlock: b }))
          )
        );
        found[i] = [...ins, ...outs].map((l) => l.transactionHash);
      }
    })
  );
  let done = 0;
  while (done < chunks.length && found[done] !== null) done++;
  return {
    hashes: [...new Set(found.slice(0, done).flat() as `0x${string}`[])],
    coveredFrom: done > 0 ? chunks[done - 1][0] : null,
    partial: done < chunks.length,
  };
}

async function balancesAt(wallet: `0x${string}`, block: bigint): Promise<Map<string, bigint>> {
  const res = await withRetry(() =>
    client.multicall({
      allowFailure: false,
      blockNumber: block,
      contracts: STOCK_ADDRESSES.map((address) => ({ address, abi: ABI, functionName: "balanceOf" as const, args: [wallet] as const })),
    })
  );
  return new Map(STOCK_ADDRESSES.map((a, i) => [a.toLowerCase(), res[i] as bigint]));
}

async function summarize(hash: `0x${string}`, wallet: string): Promise<TxSummary> {
  const r = await withRetry(() => client.getTransactionReceipt({ hash }));
  const moves: Move[] = [];
  for (const log of r.logs) {
    const token = log.address.toLowerCase();
    if (token !== USDC && !STOCKS.has(token)) continue;
    try {
      const e = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics });
      const f = e.args.from.toLowerCase();
      const t = e.args.to.toLowerCase();
      if (e.args.value === 0n || f === t || (f !== wallet && t !== wallet)) continue;
      moves.push({ token, amount: e.args.value, dir: t === wallet ? 1 : -1, logIndex: log.logIndex });
    } catch {
      // not a standard Transfer
    }
  }
  moves.sort((a, b) => a.logIndex - b.logIndex);
  // Stock received but no USDC paid: maybe paid in ETH. Only then fetch the tx for its value.
  let ethValue: bigint | undefined;
  if (moves.some((m) => m.dir === 1 && m.token !== USDC) && !moves.some((m) => m.token === USDC && m.dir === -1)) {
    const tx = await withRetry(() => client.getTransaction({ hash })).catch(() => null);
    if (tx && tx.from.toLowerCase() === wallet && tx.value > 0n) ethValue = tx.value;
  }
  return { hash, block: r.blockNumber, moves, ethValue };
}

const anyHeld = (m: Map<string, bigint>) => [...m.values()].some((v) => v > 0n);

async function loadHistory(wallet: `0x${string}`): Promise<WalletHistory> {
  const key = wallet.toLowerCase();
  const deadline = Date.now() + TIME_BUDGET_MS;
  const latest = await client.getBlockNumber();
  // Reuse a cached history only while it is fresh: catching up days of 0.2s blocks in one request (with no
  // time budget) blew through the 60s function limit. A stale entry is rebuilt with the budgeted scan instead.
  const cached = cache.get(key);
  const prev = cached && Date.now() - cached.at < CACHE_TTL_MS && latest - cached.scannedTo <= FIRST_WINDOW ? cached : undefined;
  const txs = new Map(prev?.txs ?? []);
  const addTxs = async (hashes: `0x${string}`[]) => {
    const fresh = hashes.filter((h) => !txs.has(h));
    if (txs.size + fresh.length > MAX_TXS) throw new Error("TOO_MANY");
    for (const s of await pool(fresh, CONCURRENCY, (h) => summarize(h, key))) txs.set(s.hash, s);
  };

  let scannedFrom: bigint;
  let opening: Map<string, bigint>;
  if (prev) {
    // New blocks since the last scan (small, always completed)
    if (latest > prev.scannedTo) await addTxs((await scanRange(wallet, prev.scannedTo + 1n, latest)).hashes);
    scannedFrom = prev.scannedFrom;
    opening = prev.opening;
  } else {
    // Recent window first: fast, and enough for most wallets. Also within the time budget: when the RPC is
    // slow, only the gap-free newest part counts and the rest is valued from the balances at its start.
    const windowFrom = latest - FIRST_WINDOW > START_BLOCK ? latest - FIRST_WINDOW : START_BLOCK;
    const first = await scanRange(wallet, windowFrom, latest, deadline);
    await addTxs(first.hashes);
    scannedFrom = first.coveredFrom ?? latest;
    opening = scannedFrom > START_BLOCK ? await balancesAt(wallet, scannedFrom - 1n) : new Map();
  }

  // Positions were already open at the window start: extend backwards (doubling) within the time budget.
  // A later request continues from here, so an estimated cost basis gets exact over time.
  while (anyHeld(opening) && scannedFrom > START_BLOCK && Date.now() < deadline) {
    const span = latest - scannedFrom > FIRST_WINDOW ? latest - scannedFrom : FIRST_WINDOW;
    const nextFrom = scannedFrom - span > START_BLOCK ? scannedFrom - span : START_BLOCK;
    const r = await scanRange(wallet, nextFrom, scannedFrom - 1n, deadline);
    if (r.coveredFrom === null) break;
    await addTxs(r.hashes);
    scannedFrom = r.coveredFrom;
    opening = scannedFrom > START_BLOCK ? await balancesAt(wallet, scannedFrom - 1n) : new Map();
    if (r.partial) break;
  }

  const history = { scannedFrom, scannedTo: latest, opening, txs, at: Date.now() };
  cache.set(key, history);
  if (cache.size > 500) {
    for (const [k, v] of cache) if (Date.now() - v.at > CACHE_TTL_MS) cache.delete(k);
  }
  return history;
}

async function navAt(feed: `0x${string}`, block: bigint): Promise<number | null> {
  const k = `${feed}:${block}`;
  if (navCache.has(k)) return navCache.get(k)!;
  try {
    const [, answer] = await withRetry(() => client.readContract({ address: feed, abi: ABI, functionName: "latestRoundData", blockNumber: block }));
    const v = answer > 0n ? Number(answer) / 1e8 : null;
    if (v) navCache.set(k, v);
    return v;
  } catch {
    return null;
  }
}

interface Position {
  symbol: string;
  b20Address: string;
  raw: bigint;
  costUsd: number;
  realizedUsd: number;
  estimated: boolean;
  buys: number;
  sells: number;
}

/** One stock movement of the wallet, newest first in the response (shown as trade history) */
interface Activity {
  hash: string;
  block: bigint;
  side: "buy" | "sell";
  symbol: string;
  tokens: number;
  usd: number;
  /** what was paid / received: usdc, eth, or other (transfer, another token: value at NAV) */
  via: "usdc" | "eth" | "other";
}

const blockTimes = new Map<bigint, number>();
async function blockTime(block: bigint) {
  if (!blockTimes.has(block)) {
    const b = await client.getBlock({ blockNumber: block }).catch(() => null);
    if (!b) return null;
    if (blockTimes.size > 5000) blockTimes.clear();
    blockTimes.set(block, Number(b.timestamp));
  }
  return blockTimes.get(block)!;
}

async function computePositions(history: WalletHistory) {
  const activity: Activity[] = [];
  const pos = new Map<string, Position>();
  const get = (token: string) => {
    let p = pos.get(token);
    if (!p) {
      const s = STOCKS.get(token)!;
      p = { symbol: s.symbol, b20Address: s.b20Address, raw: 0n, costUsd: 0, realizedUsd: 0, estimated: false, buys: 0, sells: 0 };
      pos.set(token, p);
    }
    return p;
  };
  const tokensOf = (raw: bigint, token: string) => Number(raw) / 10 ** STOCKS.get(token)!.decimals;

  // Positions opened before the scanned window: valued at the NAV at the window start
  for (const [token, raw] of history.opening) {
    if (raw <= 0n) continue;
    const p = get(token);
    const nav = await navAt(STOCKS.get(token)!.chainlinkFeed, history.scannedFrom - 1n);
    p.raw = raw;
    p.costUsd = (nav ?? 0) * tokensOf(raw, token);
    p.estimated = true;
  }

  const ordered = [...history.txs.values()].sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
  for (const tx of ordered) {
    let usdcOut = 0n; // paid but not yet matched to a stock received
    let ethPaid = tx.ethValue ?? 0n; // a buy paid in ETH: matched to the first stock received
    const disposals: { token: string; raw: bigint; costRemoved: number; proceeds: bigint }[] = [];
    for (const m of tx.moves) {
      if (m.token === USDC) {
        if (m.dir === -1) usdcOut += m.amount;
        else if (disposals.length) disposals[disposals.length - 1].proceeds += m.amount;
        continue;
      }
      const p = get(m.token);
      if (m.dir === 1) {
        let cost: number;
        let via: Activity["via"] = "other";
        if (usdcOut > 0n) {
          cost = Number(usdcOut) / 1e6;
          usdcOut = 0n;
          via = "usdc";
        } else if (ethPaid > 0n && (await navAt(ETH_USD_FEED, tx.block))) {
          // ETH actually paid x Chainlink ETH/USD at that block (exact enough, not an estimate)
          cost = (Number(ethPaid) / 1e18) * (await navAt(ETH_USD_FEED, tx.block))!;
          ethPaid = 0n;
          via = "eth";
        } else {
          const nav = await navAt(STOCKS.get(m.token)!.chainlinkFeed, tx.block);
          cost = (nav ?? 0) * tokensOf(m.amount, m.token);
          p.estimated = true;
        }
        p.raw += m.amount;
        p.costUsd += cost;
        p.buys++;
        activity.push({ hash: tx.hash, block: tx.block, side: "buy", symbol: p.symbol, tokens: tokensOf(m.amount, m.token), usd: cost, via });
      } else {
        const sold = m.amount > p.raw ? p.raw : m.amount;
        const avg = p.raw > 0n ? p.costUsd / tokensOf(p.raw, m.token) : 0;
        const costRemoved = avg * tokensOf(sold, m.token);
        p.raw -= sold;
        p.costUsd = p.raw > 0n ? Math.max(0, p.costUsd - costRemoved) : 0;
        p.sells++;
        disposals.push({ token: m.token, raw: m.amount, costRemoved, proceeds: 0n });
      }
    }
    for (const d of disposals) {
      const p = get(d.token);
      let proceeds: number;
      const via: Activity["via"] = d.proceeds > 0n ? "usdc" : "other";
      if (d.proceeds > 0n) proceeds = Number(d.proceeds) / 1e6;
      else {
        const nav = await navAt(STOCKS.get(d.token)!.chainlinkFeed, tx.block);
        proceeds = (nav ?? 0) * tokensOf(d.raw, d.token);
        p.estimated = true;
      }
      p.realizedUsd += proceeds - d.costRemoved;
      activity.push({ hash: tx.hash, block: tx.block, side: "sell", symbol: p.symbol, tokens: tokensOf(d.raw, d.token), usd: proceeds, via });
    }
  }

  const positions = [...pos.entries()].map(([token, p]) => {
    const tokens = tokensOf(p.raw, token);
    return {
      symbol: p.symbol,
      b20Address: p.b20Address,
      tokens,
      costBasisUsd: p.costUsd,
      avgCostUsd: tokens > 0 ? p.costUsd / tokens : null,
      realizedUsd: p.realizedUsd,
      estimated: p.estimated,
      buys: p.buys,
      sells: p.sells,
    };
  });
  // newest first, capped: the UI shows recent trades, BaseScan has the rest
  const recent = activity.reverse().slice(0, 50);
  const times = await pool([...new Set(recent.map((a) => a.block))], CONCURRENCY, async (b) => [b, await blockTime(b)] as const);
  const timeOf = new Map(times);
  return {
    positions,
    activity: recent.map((a) => ({ ...a, block: Number(a.block), time: timeOf.get(a.block) ?? null })),
  };
}

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ ok: false, error: "Invalid wallet address." }, { status: 400 });
  }
  const key = wallet.toLowerCase();
  try {
    const cached = cache.get(key);
    let history: WalletHistory;
    if (cached && Date.now() - cached.at < 15_000) history = cached;
    else if (!cached && !inflight.has(key) && inflight.size >= MAX_PARALLEL_SCANS) {
      // A first scan costs dozens of RPC calls: cap them globally so random addresses can't drain the RPC quota
      return NextResponse.json({ ok: false, error: "P/L is busy right now. Please retry in a few seconds." }, { status: 503 });
    } else {
      if (!inflight.has(key)) inflight.set(key, loadHistory(wallet as `0x${string}`).finally(() => inflight.delete(key)));
      // Answer before the 60s function limit (a 504 shows the user nothing useful). The scan keeps running
      // after the response and is cached, so the next request is fast.
      const scan = inflight.get(key)!;
      const done = await Promise.race([scan, new Promise<null>((r) => setTimeout(() => r(null), RESPONSE_BUDGET_MS))]);
      if (!done) {
        after(() => scan.then(() => undefined, () => undefined));
        return NextResponse.json({ ok: false, loading: true, error: "P/L is still loading for this wallet." }, { status: 202 });
      }
      history = done;
    }
    const { positions, activity } = await computePositions(history);
    const fromBlock = await client.getBlock({ blockNumber: history.scannedFrom }).catch(() => null);
    return NextResponse.json({
      ok: true,
      wallet,
      // realized P/L and exact cost basis cover trades since this date
      since: fromBlock ? new Date(Number(fromBlock.timestamp) * 1000).toISOString() : null,
      complete: !anyHeld(history.opening),
      trades: history.txs.size,
      positions,
      activity,
      realizedUsd: positions.reduce((a, p) => a + p.realizedUsd, 0),
    });
  } catch (e) {
    const tooMany = e instanceof Error && e.message === "TOO_MANY";
    if (!tooMany) console.error("pnl error", redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200));
    return NextResponse.json(
      {
        ok: false,
        error: tooMany
          ? "This wallet has too many stock transfers to compute P/L here."
          : "P/L is unavailable right now. Please retry in a moment.",
      },
      { status: tooMany ? 422 : 502 }
    );
  }
}
