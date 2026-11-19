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
// Stay friendly to strict free/starter RPC block-range limits (10k-50k blocks)
const CHUNK = process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL ? 20_000n : 45_000n;
// ~3 days at Base's 0.2s block time (it was 2s until late Oct 2026, so older ranges cover more time)
const FIRST_WINDOW = 1_300_000n;
const CONCURRENCY = 2; // gentle on public / free-tier RPC rate limits
// The log scan is bound by the RPC's rate limit (more parallel workers made it slower, not faster). 15s keeps a
// first scan well inside the response budget: older lots are then valued at NAV ("estimated") and later
// requests continue the scan until the cost basis is exact.
const TIME_BUDGET_MS = 15_000;
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
type TxSummary = { hash: string; block: bigint; txIndex: number; moves: Move[]; ethValue?: bigint };
interface WalletHistory {
  /** history is complete from this block (inclusive) to scannedTo */
  scannedFrom: bigint;
  scannedTo: bigint;
  /** raw balances held at scannedFrom - 1 (non-zero = position opened before the window) */
  opening: Map<string, bigint>;
  openingPartial?: boolean;
  incrementalPartial?: boolean;
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

async function withRetry<T>(fn: () => Promise<T>, tries = 4, deadline = Infinity): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (Date.now() + 600 * (i + 1) >= deadline) break;
      await new Promise((r) => setTimeout(r, 600 * (i + 1))); // rate-limit backoff
    }
  }
  throw last;
}

async function fetchTransferLogs(
  wallet: `0x${string}`,
  dir: "to" | "from",
  a: bigint,
  b: bigint
) {
  const args = dir === "to" ? { to: wallet } : { from: wallet };
  return client.getLogs({ address: STOCK_ADDRESSES, event: TRANSFER, args, fromBlock: a, toBlock: b });
}

type TransferLogList = Awaited<ReturnType<typeof fetchTransferLogs>>;

async function getTransferLogsAdaptive(
  wallet: `0x${string}`,
  dir: "to" | "from",
  a: bigint,
  b: bigint,
  deadline: number
): Promise<TransferLogList> {
  try {
    return await fetchTransferLogs(wallet, dir, a, b);
  } catch (e) {
    if (Date.now() >= deadline) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (b - a <= 2_000n) {
      return withRetry(() => fetchTransferLogs(wallet, dir, a, b), 2, deadline);
    }
    if (!/limit|range|exceed|more than|too large|response size|block|10,?000|timeout/i.test(msg)) {
      try {
        return await withRetry(() => fetchTransferLogs(wallet, dir, a, b), 2, deadline);
      } catch {}
    }
    if (Date.now() >= deadline) throw e;
    const mid = a + (b - a) / 2n;
    const left = await getTransferLogsAdaptive(wallet, dir, a, mid, deadline);
    if (Date.now() >= deadline) throw new Error("Scan deadline reached during range split");
    const right = await getTransferLogsAdaptive(wallet, dir, mid + 1n, b, deadline);
    return [...left, ...right];
  }
}

/**
 * Stock Transfer logs in/out of the wallet for [from, to].
 * Scans newest-first by default (`forward = false`) so partial scans yield a gap-free tail [coveredFrom, to],
 * or oldest-first (`forward = true`) for incremental catch-up so completed chunks extend [from, coveredTo] gap-free.
 */
async function scanRange(wallet: `0x${string}`, from: bigint, to: bigint, deadline = Infinity, forward = false) {
  const chunks: [bigint, bigint][] = [];
  if (forward) {
    for (let a = from; a <= to; a += CHUNK) chunks.push([a, a + CHUNK - 1n > to ? to : a + CHUNK - 1n]);
  } else {
    for (let e = to; e >= from; e -= CHUNK) chunks.push([e - CHUNK + 1n < from ? from : e - CHUNK + 1n, e]);
  }
  const found: (`0x${string}`[] | null)[] = chunks.map(() => null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY / 2, chunks.length) }, async () => {
      while (next < chunks.length && Date.now() < deadline) {
        const i = next++;
        const [a, b] = chunks[i];
        try {
          const [ins, outs] = await Promise.all([
            getTransferLogsAdaptive(wallet, "to", a, b, deadline),
            getTransferLogsAdaptive(wallet, "from", a, b, deadline),
          ]);
          found[i] = [...ins, ...outs].map((l) => l.transactionHash);
        } catch (e) {
          // Deadline reached mid-chunk: stop cleanly so completed newer chunks still form a gap-free tail
          if (Date.now() >= deadline) break;
          throw e;
        }
      }
    })
  );
  let done = 0;
  while (done < chunks.length && found[done] !== null) done++;
  return {
    hashes: [...new Set(found.slice(0, done).flat() as `0x${string}`[])],
    coveredFrom: done > 0 ? (forward ? chunks[0][0] : chunks[done - 1][0]) : null,
    coveredTo: done > 0 ? (forward ? chunks[done - 1][1] : chunks[0][1]) : null,
    partial: done < chunks.length,
  };
}

async function balancesAt(wallet: `0x${string}`, block: bigint, deadline = Infinity): Promise<{ map: Map<string, bigint>; anyFailed: boolean }> {
  const res = await withRetry(
    () =>
      client.multicall({
        allowFailure: true,
        blockNumber: block,
        contracts: STOCK_ADDRESSES.map((address) => ({ address, abi: ABI, functionName: "balanceOf" as const, args: [wallet] as const })),
      }),
    4,
    deadline
  );
  const map = new Map<string, bigint>();
  let anyFailed = false;
  STOCK_ADDRESSES.forEach((a, i) => {
    const r = res[i];
    if (r?.status === "success") map.set(a.toLowerCase(), r.result as bigint);
    else anyFailed = true;
  });
  return { map, anyFailed };
}

async function summarize(hash: `0x${string}`, wallet: string, deadline = Infinity): Promise<TxSummary> {
  const r = await withRetry(() => client.getTransactionReceipt({ hash }), 4, deadline);
  const rawMoves: Move[] = [];
  for (const log of r.logs) {
    const token = log.address.toLowerCase();
    if (token !== USDC && !STOCKS.has(token)) continue;
    try {
      const e = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics });
      const f = e.args.from.toLowerCase();
      const t = e.args.to.toLowerCase();
      if (e.args.value === 0n || f === t || (f !== wallet && t !== wallet)) continue;
      rawMoves.push({ token, amount: e.args.value, dir: t === wallet ? 1 : -1, logIndex: log.logIndex });
    } catch {
      // not a standard Transfer
    }
  }
  rawMoves.sort((a, b) => a.logIndex - b.logIndex);
  // Coalesce consecutive incoming transfers of the same stock in one tx (e.g. KyberSwap split route)
  const moves: Move[] = [];
  for (const m of rawMoves) {
    const prev = moves[moves.length - 1];
    if (prev && m.dir === 1 && prev.dir === 1 && prev.token === m.token && m.token !== USDC) {
      prev.amount += m.amount;
    } else {
      moves.push({ ...m });
    }
  }
  // Stock received without matching USDC payment: check scoped ETH paid on EOA or KyberRouter Swapped(NATIVE_ETH)
  let ethValue: bigint | undefined;
  const stockInMoves = moves.filter((m) => m.dir === 1 && m.token !== USDC);
  const usdcOutCount = moves.filter((m) => m.token === USDC && m.dir === -1).length;
  if (stockInMoves.length > usdcOutCount) {
    const tx = await withRetry(() => client.getTransaction({ hash }), 4, deadline).catch(() => null);
    if (tx && tx.from.toLowerCase() === wallet && tx.value > 0n && usdcOutCount === 0) {
      ethValue = tx.value;
    } else {
      const KYBER_ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
      const SWAPPED_TOPIC = "0xd6d4f5681c246c9f42c203e287975af1601f8df8035a9251f79aab5c8f09e2f8";
      const NATIVE_ETH_LOWER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
      const WETH_BASE = "0x4200000000000000000000000000000000000006";
      const WETH_DEPOSIT_TOPIC = "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";
      const walletTopic = "0x" + wallet.replace(/^0x/, "").padStart(64, "0");
      let swappedEth = 0n;
      let wethDeposited = 0n;
      for (const log of r.logs) {
        if (log.address.toLowerCase() === KYBER_ROUTER && log.topics[0]?.toLowerCase() === SWAPPED_TOPIC && log.data.length >= 2 + 64 * 6) {
          const sender = "0x" + log.data.slice(2 + 24, 2 + 64).toLowerCase();
          const src = "0x" + log.data.slice(2 + 64 + 24, 2 + 128).toLowerCase();
          const dst = "0x" + log.data.slice(2 + 128 + 24, 2 + 192).toLowerCase();
          const dstReceiver = "0x" + log.data.slice(2 + 192 + 24, 2 + 256).toLowerCase();
          if (src === NATIVE_ETH_LOWER && STOCKS.has(dst) && (sender === wallet || dstReceiver === wallet)) {
            swappedEth += BigInt("0x" + log.data.slice(2 + 64 * 4, 2 + 64 * 5));
          }
        } else if (
          log.address.toLowerCase() === WETH_BASE &&
          log.topics[0]?.toLowerCase() === WETH_DEPOSIT_TOPIC &&
          log.topics[1]?.toLowerCase() === walletTopic &&
          log.data.length >= 66
        ) {
          wethDeposited += BigInt(log.data.slice(0, 66));
        }
      }
      const detected = swappedEth > 0n ? swappedEth : wethDeposited;
      if (detected > 0n) ethValue = detected;
    }
  }
  return { hash, block: r.blockNumber, txIndex: Number(r.transactionIndex ?? 0), moves, ethValue };
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
    for (const s of await pool(fresh, CONCURRENCY, (h) => summarize(h, key, deadline))) txs.set(s.hash, s);
  };

  let scannedFrom: bigint;
  let scannedTo: bigint;
  let opening: Map<string, bigint>;
  let openingPartial = false;
  let incrementalPartial = false;
  let shouldCache = true;
  if (prev) {
    scannedTo = prev.scannedTo;
    if (latest > prev.scannedTo) {
      // Scan chronologically from prev.scannedTo + 1n forward so partial scans never leave a gap before `scannedTo`
      try {
        const inc = await scanRange(wallet, prev.scannedTo + 1n, latest, deadline, true);
        await addTxs(inc.hashes);
        if (inc.coveredTo !== null && inc.coveredTo > scannedTo) scannedTo = inc.coveredTo;
        incrementalPartial = inc.partial;
      } catch (e) {
        if (e instanceof Error && e.message === "TOO_MANY") throw e;
        incrementalPartial = true;
      }
    }
    scannedFrom = prev.scannedFrom;
    opening = prev.opening;
    openingPartial = Boolean(prev.openingPartial);
    if (openingPartial && scannedFrom > START_BLOCK && Date.now() < deadline) {
      const ob = await balancesAt(wallet, scannedFrom - 1n, deadline).catch(() => null);
      if (ob) {
        opening = ob.map;
        openingPartial = ob.anyFailed;
      }
    }
  } else {
    // Recent window first: fast, and enough for most wallets. Also within the time budget: when the RPC is
    // slow, only the gap-free newest part counts and the rest is valued from the balances at its start.
    const windowFrom = latest - FIRST_WINDOW > START_BLOCK ? latest - FIRST_WINDOW : START_BLOCK;
    const first = await scanRange(wallet, windowFrom, latest, deadline);
    if (first.coveredFrom === null) {
      throw new Error("RPC timed out before completing initial P/L range");
    }
    await addTxs(first.hashes);
    scannedFrom = first.coveredFrom;
    scannedTo = latest;
    const ob =
      scannedFrom > START_BLOCK
        ? await balancesAt(wallet, scannedFrom - 1n, deadline).catch(() => ({ map: new Map<string, bigint>(), anyFailed: true }))
        : { map: new Map<string, bigint>(), anyFailed: false };
    opening = ob.map;
    openingPartial = ob.anyFailed;
    if (openingPartial && !anyHeld(opening)) shouldCache = false;
  }

  // Positions were already open at the window start: extend backwards (doubling) within the time budget.
  // A later request continues from here, so an estimated cost basis gets exact over time.
  while (anyHeld(opening) && scannedFrom > START_BLOCK && Date.now() < deadline) {
    const span = latest - scannedFrom > FIRST_WINDOW ? latest - scannedFrom : FIRST_WINDOW;
    const nextFrom = scannedFrom - span > START_BLOCK ? scannedFrom - span : START_BLOCK;
    const r = await scanRange(wallet, nextFrom, scannedFrom - 1n, deadline).catch(() => null);
    if (!r || r.coveredFrom === null) break;
    try {
      await addTxs(r.hashes);
    } catch (e) {
      if (e instanceof Error && e.message === "TOO_MANY") throw e;
      break;
    }
    scannedFrom = r.coveredFrom;
    const ob = scannedFrom > START_BLOCK ? await balancesAt(wallet, scannedFrom - 1n, deadline).catch(() => null) : { map: new Map(), anyFailed: false };
    if (!ob) {
      openingPartial = true;
      break;
    }
    opening = ob.map;
    openingPartial = ob.anyFailed;
    if (r.partial) break;
  }

  const history: WalletHistory = { scannedFrom, scannedTo, opening, openingPartial, incrementalPartial, txs, at: Date.now() };
  if (shouldCache) {
    cache.set(key, history);
    if (cache.size > 500) {
      for (const [k, v] of cache) if (Date.now() - v.at > CACHE_TTL_MS) cache.delete(k);
      while (cache.size > 500) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    }
  }
  return history;
}

async function navAt(feed: `0x${string}`, block: bigint): Promise<number | null> {
  const k = `${feed}:${block}`;
  if (navCache.has(k)) return navCache.get(k)!;
  try {
    const [, answer] = await withRetry(
      () => client.readContract({ address: feed, abi: ABI, functionName: "latestRoundData", blockNumber: block }),
      2
    );
    const v = answer > 0n ? Number(answer) / 1e8 : null;
    if (v) {
      navCache.set(k, v);
      if (navCache.size > 1000) {
        const oldest = navCache.keys().next().value;
        if (oldest !== undefined) navCache.delete(oldest);
      }
    }
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
  unpriced?: boolean;
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
    if (nav === null) {
      p.costUsd = 0;
      p.unpriced = true;
    } else {
      p.costUsd = nav * tokensOf(raw, token);
    }
    p.estimated = true;
  }

  const ordered = [...history.txs.values()].sort((a, b) =>
    a.block < b.block ? -1 : a.block > b.block ? 1 : a.txIndex - b.txIndex
  );
  for (const tx of ordered) {
    let usdcOut = 0n; // paid but not yet matched to a stock received
    const ethPaid = tx.ethValue ?? 0n;
    // Identify only the stock buys not already covered by a preceding USDC outflow in this tx
    let simUsdcOut = 0n;
    const ethStockBuys: Move[] = [];
    for (const m of tx.moves) {
      if (m.token === USDC) {
        if (m.dir === -1) simUsdcOut += m.amount;
      } else if (m.dir === 1) {
        if (simUsdcOut > 0n) simUsdcOut = 0n;
        else ethStockBuys.push(m);
      }
    }
    let ethLegValues: number[] | null = null;
    let ethUsdPrice: number | null = null;
    if (ethPaid > 0n && ethStockBuys.length > 0) {
      ethUsdPrice = await navAt(ETH_USD_FEED, tx.block);
      if (ethUsdPrice && ethStockBuys.length > 1) {
        const totalEthUsd = (Number(ethPaid) / 1e18) * ethUsdPrice;
        const navs = await Promise.all(
          ethStockBuys.map((m) => navAt(STOCKS.get(m.token)!.chainlinkFeed, tx.block))
        );
        // Require every ETH-funded leg's NAV to split ETH proportionally; otherwise mark affected legs unpriced
        if (navs.every((n) => n !== null && n > 0)) {
          const navEsts = ethStockBuys.map((m, idx) => navs[idx]! * tokensOf(m.amount, m.token));
          const sumEst = navEsts.reduce((a, b) => a + b, 0);
          if (sumEst > 0) ethLegValues = navEsts.map((v) => (v / sumEst) * totalEthUsd);
        }
      }
    }
    let ethIdx = 0;
    let ethPaidLeft = ethPaid;
    const usdcOutMoves = tx.moves.filter((m) => m.token === USDC && m.dir === -1);
    const buyMoves = tx.moves.filter((m) => m.token !== USDC && m.dir === 1);
    let sharedUsdcLegCosts: number[] | null = null;
    if (usdcOutMoves.length === 1 && buyMoves.length > 1 && ethPaid === 0n) {
      const totalUsdc = Number(usdcOutMoves[0].amount) / 1e6;
      const navValues = await Promise.all(
        buyMoves.map(async (m) => {
          const nav = await navAt(STOCKS.get(m.token)!.chainlinkFeed, tx.block);
          return nav !== null ? nav * tokensOf(m.amount, m.token) : 0;
        })
      );
      const navSum = navValues.reduce((a, b) => a + b, 0);
      if (navSum > 0 && navValues.every((v) => v > 0)) {
        sharedUsdcLegCosts = navValues.map((v) => (totalUsdc * v) / navSum);
      } else {
        sharedUsdcLegCosts = buyMoves.map(() => totalUsdc / buyMoves.length);
      }
    }
    let sharedBuyIdx = 0;
    let unattachedUsdcIn = 0n;
    const disposals: { token: string; raw: bigint; costRemoved: number; backedRatio: number; wasUnpriced: boolean; proceeds: bigint }[] = [];
    for (const m of tx.moves) {
      if (m.token === USDC) {
        if (m.dir === -1 && !sharedUsdcLegCosts) usdcOut += m.amount;
        else if (m.dir === 1) {
          if (disposals.length) disposals[disposals.length - 1].proceeds += m.amount;
          else unattachedUsdcIn += m.amount;
        }
        continue;
      }
      const p = get(m.token);
      if (m.dir === 1) {
        let cost: number;
        let via: Activity["via"] = "other";
        if (sharedUsdcLegCosts && sharedUsdcLegCosts[sharedBuyIdx] !== undefined) {
          cost = sharedUsdcLegCosts[sharedBuyIdx++];
          via = "usdc";
          p.estimated = true;
        } else if (usdcOut > 0n) {
          cost = Number(usdcOut) / 1e6;
          usdcOut = 0n;
          via = "usdc";
        } else if (ethLegValues && ethLegValues[ethIdx] !== undefined) {
          cost = ethLegValues[ethIdx++];
          via = "eth";
        } else if (ethPaidLeft > 0n && ethStockBuys.length === 1 && ethUsdPrice) {
          // Single ETH-funded leg (even in a mixed USDC + ETH batch): exact ETH paid x Chainlink ETH/USD
          cost = (Number(ethPaidLeft) / 1e18) * ethUsdPrice;
          ethPaidLeft = 0n;
          via = "eth";
        } else {
          const nav = await navAt(STOCKS.get(m.token)!.chainlinkFeed, tx.block);
          if (nav === null) {
            cost = 0;
            p.unpriced = true;
          } else {
            cost = nav * tokensOf(m.amount, m.token);
          }
          p.estimated = true;
        }
        p.raw += m.amount;
        p.costUsd += cost;
        p.buys++;
        activity.push({ hash: tx.hash, block: tx.block, side: "buy", symbol: p.symbol, tokens: tokensOf(m.amount, m.token), usd: cost, via });
      } else {
        const wasUnpriced = Boolean(p.unpriced);
        const sold = m.amount > p.raw ? p.raw : m.amount;
        const backedRatio = m.amount > 0n && sold > 0n ? Number(sold) / Number(m.amount) : 0;
        const avg = p.raw > 0n ? p.costUsd / tokensOf(p.raw, m.token) : 0;
        const costRemoved = avg * tokensOf(sold, m.token);
        p.raw -= sold;
        p.costUsd = p.raw > 0n ? Math.max(0, p.costUsd - costRemoved) : 0;
        if (p.raw === 0n) p.unpriced = false; // clean slate for future positions after full exit
        p.sells++;
        disposals.push({ token: m.token, raw: m.amount, costRemoved, backedRatio, wasUnpriced, proceeds: 0n });
      }
    }
    if (unattachedUsdcIn > 0n && disposals.length === 1) {
      disposals[0].proceeds += unattachedUsdcIn;
    }
    for (const d of disposals) {
      const p = get(d.token);
      let proceeds: number | null = null;
      const via: Activity["via"] = d.proceeds > 0n ? "usdc" : "other";
      if (d.proceeds > 0n) proceeds = Number(d.proceeds) / 1e6;
      else {
        const nav = await navAt(STOCKS.get(d.token)!.chainlinkFeed, tx.block);
        if (nav !== null) proceeds = nav * tokensOf(d.raw, d.token);
        p.estimated = true;
      }
      if (proceeds !== null && !d.wasUnpriced && d.backedRatio > 0) {
        p.realizedUsd += proceeds * d.backedRatio - d.costRemoved;
      }
      activity.push({ hash: tx.hash, block: tx.block, side: "sell", symbol: p.symbol, tokens: tokensOf(d.raw, d.token), usd: proceeds ?? 0, via });
    }
  }

  const positions = [...pos.entries()].map(([token, p]) => {
    const tokens = tokensOf(p.raw, token);
    return {
      symbol: p.symbol,
      b20Address: p.b20Address,
      tokens,
      costBasisUsd: p.costUsd,
      avgCostUsd: tokens > 0 && !p.unpriced ? p.costUsd / tokens : null,
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
  const fresh = request.nextUrl.searchParams.get("fresh") === "1";
  try {
    const cached = cache.get(key);
    let history: WalletHistory;
    if (!fresh && cached && Date.now() - cached.at < 15_000) history = cached;
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
    const fromTimeSec = await blockTime(history.scannedFrom);
    return NextResponse.json({
      ok: true,
      wallet,
      // realized P/L and exact cost basis cover trades since this date
      since: fromTimeSec !== null ? new Date(fromTimeSec * 1000).toISOString() : null,
      complete: !anyHeld(history.opening) && !history.openingPartial && !history.incrementalPartial,
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
