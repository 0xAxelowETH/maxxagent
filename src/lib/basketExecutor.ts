import { encodeFunctionData, decodeFunctionResult, parseAbi, toHex } from "viem";
import { alignedWithSuffix, appendBuilderCodeToCalldata, toErc8021DataSuffix } from "./builderCode";

const builderSuffix = (code: string) => toErc8021DataSuffix([code]).dataSuffix;

/**
 * Non-custodial swaps between USDC and Coinbase B20 stocks, signed in the user's own wallet.
 *   executeBasket: USDC -> several stocks (buy)
 *   executeSell:   stocks -> USDC (sell)
 * Both try one EIP-5792 batch (wallet_sendCalls) and fall back to sequential transactions.
 * Approvals are always exact amounts, never unlimited.
 */

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
/** KyberSwap's placeholder for native ETH (paid as tx value, no approval) */
export const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const isNative = (token?: string) => (token || "").toLowerCase() === NATIVE_ETH.toLowerCase();
// Below this, an EOA likely can't pay Base gas for approve + swap (~$0.05 at typical prices)
const MIN_GAS_WEI = 20_000_000_000_000n; // 0.00002 ETH
const BASE_CHAIN_HEX = "0x2105";
const USDC_DECIMALS = 6;
const B20_DECIMALS = 8;
const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface EthProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export interface BasketLeg {
  symbol: string;
  b20Address: string;
  usd: number;
  /** pay in USDC (default) or native ETH */
  payWith?: "usdc" | "eth";
}

export interface SellLeg {
  symbol: string;
  b20Address: string;
  /** stock token units to sell */
  tokens: number;
}

export interface LegQuote {
  ok: boolean;
  side?: "buy" | "sell";
  symbol: string;
  error?: string;
  routerAddress?: string;
  tokenIn?: string;
  tokenOut?: string;
  tx?: { to: string; data: string; value: string };
  amountInRaw?: string;
  amountOutShares?: number;
  amountOutUsdc?: number;
  amountInTokens?: number;
  b20Address?: string;
  amountOutUsd?: number;
  amountInUsd?: number;
  payWith?: "usdc" | "eth";
  amountInEth?: number;
  /** guaranteed minimum out after slippage (raw units of tokenOut) */
  minAmountOutRaw?: string;
  /** % worse than the Chainlink NAV (negative = better than NAV); null if NAV unavailable */
  navDeviationPct?: number | null;
  costPct?: number;
  venues?: string[];
}

export interface ReceivedAmount {
  symbol: string;
  b20Address: string;
  raw: string;
  tokens: number;
  quotedTokens?: number;
}

export interface TrackedTx {
  hash: string;
  status: "confirmed" | "failed" | "unknown";
  gasUsed?: string;
  blockNumber?: number;
}

export interface BasketResult {
  side: "buy" | "sell";
  mode: "batch" | "sequential";
  txHashes: string[];
  /** legs that were executed (named `bought` for backwards compatibility; holds sold legs on a sell) */
  bought: LegQuote[];
  skipped: LegQuote[];
  /** Actual amounts received, read from onchain Transfer events (not the quote) */
  received: ReceivedAmount[];
  txs: TrackedTx[];
  /** legs that did not go through when sent one by one (the others did) */
  failed: FailedLeg[];
}

type StatusFn = (msg: string) => void;
type Call = { to: string; data: string; value: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- helpers

async function readErc20(eth: EthProvider, token: string, fn: "balanceOf" | "allowance", args: readonly `0x${string}`[]) {
  const data =
    fn === "balanceOf"
      ? encodeFunctionData({ abi: ERC20_ABI, functionName: "balanceOf", args: [args[0]] })
      : encodeFunctionData({ abi: ERC20_ABI, functionName: "allowance", args: [args[0], args[1]] });
  const raw = (await eth.request({ method: "eth_call", params: [{ to: token, data }, "latest"] })) as `0x${string}`;
  return decodeFunctionResult({ abi: ERC20_ABI, functionName: fn, data: raw }) as bigint;
}

async function waitForReceipt(eth: EthProvider, hash: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const receipt = (await eth.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status && receipt.status !== "0x1") throw new Error(`Transaction ${hash} reverted`);
      return;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for ${hash}`);
}

function isUnsupportedMethod(err: unknown) {
  const e = err as { code?: number; message?: string };
  return (
    e?.code === 4200 ||
    e?.code === -32601 ||
    e?.code === -32602 ||
    /not supported|unsupported|does not exist|not found|unknown method/i.test(e?.message || "")
  );
}

async function ensureBase(eth: EthProvider, onStatus: StatusFn) {
  const chain = ((await eth.request({ method: "eth_chainId" })) as string)?.toLowerCase();
  if (chain !== BASE_CHAIN_HEX) {
    onStatus("Switching wallet to Base Mainnet…");
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_HEX }] });
  }
}

/** Reads receipts and sums Transfer(to = sender) events for the given tokens. */
async function trackReceipts(
  eth: EthProvider,
  txHashes: string[],
  sender: string,
  watch: { address: string; symbol: string; decimals: number; quoted?: number }[]
): Promise<{ received: ReceivedAmount[]; txs: TrackedTx[] }> {
  const senderTopic = "0x" + sender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const byAddr = new Map(watch.map((w) => [w.address.toLowerCase(), w]));
  const sums = new Map<string, bigint>();
  const txs: TrackedTx[] = [];
  for (const hash of txHashes) {
    try {
      const r = (await eth.request({ method: "eth_getTransactionReceipt", params: [hash] })) as {
        status?: string;
        gasUsed?: string;
        blockNumber?: string;
        logs?: { address: string; topics: string[]; data: string }[];
      } | null;
      if (!r) {
        txs.push({ hash, status: "unknown" });
        continue;
      }
      txs.push({
        hash,
        status: r.status === "0x1" ? "confirmed" : r.status === "0x0" ? "failed" : "unknown",
        gasUsed: r.gasUsed ? BigInt(r.gasUsed).toString() : undefined,
        blockNumber: r.blockNumber ? Number(BigInt(r.blockNumber)) : undefined,
      });
      for (const log of r.logs || []) {
        const addr = log.address.toLowerCase();
        if (!byAddr.has(addr) || log.topics[0] !== TRANSFER_TOPIC) continue;
        if ((log.topics[2] || "").toLowerCase() !== senderTopic) continue;
        sums.set(addr, (sums.get(addr) ?? 0n) + BigInt(log.data));
      }
    } catch {
      txs.push({ hash, status: "unknown" });
    }
  }
  const received: ReceivedAmount[] = [...byAddr.entries()].map(([addr, w]) => {
    const raw = sums.get(addr) ?? 0n;
    return { symbol: w.symbol, b20Address: addr, raw: raw.toString(), tokens: Number(raw) / 10 ** w.decimals, quotedTokens: w.quoted };
  });
  return { received, txs };
}

/** Exact-amount approvals per (token, router) pair, only where the current allowance is too low. */
async function buildApprovals(eth: EthProvider, sender: string, legs: LegQuote[], builderCode: string): Promise<Call[]> {
  const needed = new Map<string, { token: string; router: string; amount: bigint }>();
  for (const q of legs) {
    if (isNative(q.tokenIn)) continue; // ETH is sent as value: nothing to approve
    const key = `${q.tokenIn!.toLowerCase()}|${q.routerAddress!.toLowerCase()}`;
    const cur = needed.get(key);
    needed.set(key, { token: q.tokenIn!, router: q.routerAddress!, amount: (cur?.amount ?? 0n) + BigInt(q.amountInRaw!) });
  }
  const calls: Call[] = [];
  for (const { token, router, amount } of needed.values()) {
    const allowance = await readErc20(eth, token, "allowance", [sender as `0x${string}`, router as `0x${string}`]);
    if (allowance < amount) {
      const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [router as `0x${string}`, amount] });
      calls.push({ to: token, data: appendBuilderCodeToCalldata(data, builderCode), value: "0x0" });
    }
  }
  return calls;
}

/** True when the user declined in the wallet (never retried in another form). */
function isUserRejection(err: unknown) {
  const e = err as { code?: number; message?: string };
  return e?.code === 4001 || /user (rejected|denied|cancel)|rejected by (the )?user|request rejected|denied transaction|cancell?ed/i.test(e?.message || "");
}

const shortError = (err: unknown) => {
  const m = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err ?? "failed");
  if (/reverted/i.test(m)) return "Swap reverted onchain (price moved or liquidity changed); only gas was spent";
  // Not a failure: it may still confirm. Saying "failed" could make the user buy again.
  if (/timed out/i.test(m)) return "Still pending after 2 minutes: check BaseScan before retrying";
  return m.slice(0, 140);
};

export interface FailedLeg {
  label: string;
  error: string;
}

/**
 * Sends approvals + swaps: one EIP-5792 batch if the wallet supports it, otherwise one by one.
 * `spend` = tokens the order spends; their balances guard the fallback against sending twice.
 */
async function sendCalls(
  eth: EthProvider,
  sender: string,
  approveCalls: Call[],
  swapCalls: Call[],
  labels: string[],
  onStatus: StatusFn,
  builderCode: string,
  spend: string[],
  /** token and amount each swap call spends (same order as swapCalls) */
  swapSpend: { token: string; amount: bigint }[]
): Promise<{ mode: "batch" | "sequential"; txHashes: string[]; failed: FailedLeg[] }> {
  const calls = [...approveCalls, ...swapCalls];
  const balancesOf = () => Promise.all(spend.map((t) => readErc20(eth, t, "balanceOf", [sender as `0x${string}`]).catch(() => null)));
  const before = await balancesOf();
  // Nonce = number of txs this address has sent: covers ETH-paid orders (no token balance to compare)
  const nonceOf = () =>
    (eth.request({ method: "eth_getTransactionCount", params: [sender, "latest"] }) as Promise<string>).then((n) => BigInt(n)).catch(() => null);
  const nonceBefore = await nonceOf();
  onStatus(`Confirm ${calls.length} action${calls.length > 1 ? "s" : ""} in one wallet prompt…`);
  // Smart wallets (ERC-4337) wrap calls in executeBatch, so the per-call suffix is not at the end of
  // the UserOp callData. Base's documented fix: the optional `dataSuffix` capability, appended by the wallet.
  const base = { version: "2.0.0", chainId: BASE_CHAIN_HEX, from: sender, atomicRequired: false, calls };
  let batchId: string | undefined;
  try {
    let sendRes: string | { id: string };
    try {
      sendRes = (await eth.request({
        method: "wallet_sendCalls",
        params: [{ ...base, capabilities: { dataSuffix: { value: builderSuffix(builderCode), optional: true } } }],
      })) as string | { id: string };
    } catch (capErr) {
      // Non-compliant wallets may reject the optional capability: retry once without it.
      const e = capErr as { code?: number; message?: string };
      if (e?.code !== 5700 && !/capabilit/i.test(e?.message || "")) throw capErr;
      sendRes = (await eth.request({ method: "wallet_sendCalls", params: [base] })) as string | { id: string };
    }
    batchId = typeof sendRes === "string" ? sendRes : sendRes?.id;
  } catch (err) {
    if (isUserRejection(err)) throw err;
    if (!isUnsupportedMethod(err)) {
      // Unknown error (wallets word "no batching" in many ways). Before sending one by one, make sure the
      // batch did not go through anyway: if any spent balance dropped, never resend (no double trade).
      await sleep(5000);
      const [after, nonceAfter] = await Promise.all([balancesOf(), nonceOf()]);
      const nonceMoved = nonceBefore !== null && nonceAfter !== null && nonceAfter > nonceBefore;
      if (nonceMoved || after.some((a, i) => a !== null && before[i] !== null && a < before[i]!)) {
        throw new Error("Your wallet reported an error, but funds have moved. Check your wallet activity before retrying.");
      }
    }
    onStatus("Your wallet doesn't support one-prompt batches: confirming each step…");
  }

  if (batchId) {
    // The batch was submitted: from here on, never resend the calls (that would double the trade).
    onStatus("Waiting for confirmation onchain…");
    const start = Date.now();
    let misses = 0;
    while (Date.now() - start < 180_000) {
      let status: { status?: number | string; receipts?: { transactionHash: string; status?: string }[] } | undefined;
      try {
        status = (await eth.request({ method: "wallet_getCallsStatus", params: [batchId] })) as typeof status;
      } catch {
        // Some wallets briefly report an unknown id right after submission
        if (++misses > 10) throw new Error("Batch was sent but its status is unavailable. Check your wallet activity before retrying.");
      }
      const done = status?.status === 200 || status?.status === "CONFIRMED" || status?.status === "success";
      const failed = (typeof status?.status === "number" && status.status >= 400) || status?.status === "failure";
      if (failed) throw new Error("Batch failed onchain. Nothing was swapped in the failed calls.");
      if (done) return { mode: "batch", txHashes: [...new Set((status!.receipts || []).map((r) => r.transactionHash))], failed: [] };
      await sleep(2000);
    }
    throw new Error("Timed out waiting for batch confirmation. Check your wallet activity before retrying.");
  }

  // One by one. Approvals first (a failed approval stops everything: nothing has been swapped yet).
  const txHashes: string[] = [];
  for (let i = 0; i < approveCalls.length; i++) {
    const c = approveCalls[i];
    onStatus(`Approve (${i + 1}/${calls.length})…`);
    const hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from: sender, to: c.to, data: c.data, value: c.value }] })) as string;
    txHashes.push(hash);
    await waitForReceipt(eth, hash);
  }
  // Swaps are independent: one failing must not hide the others that succeeded
  const failed: FailedLeg[] = [];
  let swapped = 0;
  const spentSoFar = new Map<string, bigint>();
  for (let j = 0; j < swapCalls.length; j++) {
    const c = swapCalls[j];
    // Double-trade guard: if the token balance dropped more than this order has spent, something else
    // spent it (e.g. the batch went through late after an error). Stop instead of buying twice.
    const { token, amount } = swapSpend[j];
    const idx = spend.findIndex((t) => t.toLowerCase() === token.toLowerCase());
    const start = idx >= 0 ? before[idx] : null;
    if (start !== null) {
      const now = await readErc20(eth, token, "balanceOf", [sender as `0x${string}`]).catch(() => null);
      const expected = start - (spentSoFar.get(token.toLowerCase()) ?? 0n);
      if (now !== null && now < expected) {
        for (let k = j; k < swapCalls.length; k++)
          failed.push({ label: labels[k], error: "Stopped: funds moved outside this order (the batch may have gone through). Check your wallet activity" });
        break;
      }
    }
    onStatus(`${labels[j]} (${approveCalls.length + j + 1}/${calls.length})…`);
    let hash: string | undefined;
    try {
      hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from: sender, to: c.to, data: c.data, value: c.value }] })) as string;
      txHashes.push(hash);
      // Counted as spent as soon as it is sent: a reverted swap returns the funds, so the guard then only
      // under-estimates the balance (never stops wrongly in the dangerous direction)
      spentSoFar.set(token.toLowerCase(), (spentSoFar.get(token.toLowerCase()) ?? 0n) + amount);
      await waitForReceipt(eth, hash);
      swapped++;
    } catch (err) {
      if (isUserRejection(err)) {
        // The user stopped: report this leg and the remaining ones as cancelled
        for (let k = j; k < swapCalls.length; k++) failed.push({ label: labels[k], error: "Cancelled in wallet" });
        break;
      }
      failed.push({ label: labels[j], error: shortError(err) });
    }
  }
  if (swapped === 0) {
    const first = failed[0];
    throw new Error(first?.error === "Cancelled in wallet" ? "Cancelled in wallet. Nothing was swapped." : first?.error || "No swap went through.");
  }
  return { mode: "sequential", txHashes, failed };
}

/**
 * Sends ONE contract call that moves no funds (e.g. publishing an index) and resolves with the mined tx hash.
 * Same safety as orders: Builder Code 32-byte aligned + the dataSuffix capability for smart wallets, EIP-5792
 * first, one eth_sendTransaction fallback guarded by the nonce, and success only after a successful receipt.
 */
export async function sendContractCall(params: {
  eth: EthProvider;
  sender: string;
  to: string;
  data: `0x${string}`;
  builderCode: string;
  onStatus?: StatusFn;
}): Promise<string> {
  const { eth, sender, to, builderCode, onStatus = () => {} } = params;
  await ensureBase(eth, onStatus);
  const suffix = builderSuffix(builderCode);
  const call = { to, data: alignedWithSuffix(params.data, suffix), value: "0x0" };
  const nonceOf = () =>
    (eth.request({ method: "eth_getTransactionCount", params: [sender, "latest"] }) as Promise<string>).then((n) => BigInt(n)).catch(() => null);
  const nonceBefore = await nonceOf();
  onStatus("Confirm in your wallet…");
  const base = { version: "2.0.0", chainId: BASE_CHAIN_HEX, from: sender, atomicRequired: false, calls: [call] };
  let batchId: string | undefined;
  try {
    let res: string | { id: string };
    try {
      res = (await eth.request({
        method: "wallet_sendCalls",
        params: [{ ...base, capabilities: { dataSuffix: { value: suffix, optional: true } } }],
      })) as string | { id: string };
    } catch (capErr) {
      const e = capErr as { code?: number; message?: string };
      if (e?.code !== 5700 && !/capabilit/i.test(e?.message || "")) throw capErr;
      res = (await eth.request({ method: "wallet_sendCalls", params: [base] })) as string | { id: string };
    }
    batchId = typeof res === "string" ? res : res?.id;
  } catch (err) {
    if (isUserRejection(err)) throw new Error("Cancelled in wallet.");
    if (!isUnsupportedMethod(err)) {
      // Unknown wallet error: make sure nothing was sent before asking again another way
      await sleep(5000);
      const nonceAfter = await nonceOf();
      if (nonceBefore !== null && nonceAfter !== null && nonceAfter > nonceBefore) {
        throw new Error("Your wallet reported an error, but a transaction was sent. Check your wallet activity before retrying.");
      }
    }
  }

  if (batchId) {
    onStatus("Waiting for confirmation onchain…");
    const start = Date.now();
    let misses = 0;
    while (Date.now() - start < 180_000) {
      let status: { status?: number | string; receipts?: { transactionHash: string; status?: string }[] } | undefined;
      try {
        status = (await eth.request({ method: "wallet_getCallsStatus", params: [batchId] })) as typeof status;
      } catch {
        if (++misses > 10) throw new Error("Sent, but the status is unavailable. Check your wallet activity before retrying.");
      }
      const failed = (typeof status?.status === "number" && status.status >= 400) || status?.status === "failure";
      if (failed || status?.receipts?.some((r) => r.status === "0x0")) throw new Error("The transaction failed onchain (only gas was spent).");
      const done = status?.status === 200 || status?.status === "CONFIRMED" || status?.status === "success";
      if (done) {
        const hash = status!.receipts?.[0]?.transactionHash;
        if (!hash) throw new Error("Confirmed, but the wallet returned no transaction hash. Check your wallet activity.");
        return hash;
      }
      await sleep(2000);
    }
    throw new Error("Still pending after 3 minutes: check your wallet activity before retrying.");
  }

  let hash: string;
  try {
    hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from: sender, ...call }] })) as string;
  } catch (err) {
    if (isUserRejection(err)) throw new Error("Cancelled in wallet.");
    throw err;
  }
  onStatus("Waiting for confirmation onchain…");
  try {
    await waitForReceipt(eth, hash);
  } catch (err) {
    const m = err instanceof Error ? err.message : "";
    if (/reverted/i.test(m)) throw new Error("The transaction reverted onchain (only gas was spent).");
    if (/timed out/i.test(m)) throw new Error(`Still pending after 2 minutes: check BaseScan (${hash}) before retrying.`);
    throw err;
  }
  return hash;
}

async function postSwap(body: Record<string, unknown>, fallbackSymbol: string): Promise<LegQuote> {
  try {
    const res = await fetch("/api/swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    return { ...data, symbol: data?.symbol || fallbackSymbol };
  } catch (e) {
    return { ok: false, symbol: fallbackSymbol, error: e instanceof Error ? e.message : "Quote failed" };
  }
}

// KyberSwap MetaAggregationRouterV2 on Base: the only address we ever approve or call
const KYBER_ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const usable = (q: LegQuote) =>
  !!(
    q.ok &&
    q.tx &&
    q.amountInRaw &&
    q.tokenIn &&
    q.routerAddress?.toLowerCase() === KYBER_ROUTER &&
    q.tx.to.toLowerCase() === KYBER_ROUTER &&
    BigInt(q.tx.value || "0") === (isNative(q.tokenIn) ? BigInt(q.amountInRaw) : 0n)
  );

const withSkipReason = (q: LegQuote): LegQuote => (q.error ? q : { ...q, error: "Unexpected route, skipped for safety" });

/** Quotes legs one by one (aggregator burst limit), then retries failed legs once after a pause. */
async function quoteAll<L extends { symbol: string }>(
  legs: L[],
  quote: (leg: L) => Promise<LegQuote>,
  verb: string,
  onStatus: StatusFn
): Promise<LegQuote[]> {
  const quotes: LegQuote[] = [];
  for (const [i, leg] of legs.entries()) {
    if (i > 0) await sleep(500);
    onStatus(`Finding best route ${verb} ${leg.symbol} (${i + 1}/${legs.length})…`);
    quotes.push(await quote(leg));
  }
  const failed = quotes.map((q, i) => (usable(q) ? -1 : i)).filter((i) => i >= 0);
  // Retry only when part of the basket failed (usually a rate limit); a single failed leg reports its error
  if (failed.length > 0 && failed.length < legs.length) {
    await sleep(2000);
    for (const i of failed) {
      onStatus(`Retrying route ${verb} ${legs[i].symbol}…`);
      const retry = await quote(legs[i]);
      if (usable(retry)) quotes[i] = retry;
      await sleep(700);
    }
  }
  return quotes;
}
const toSwapCall = (q: LegQuote): Call => ({ to: q.tx!.to, data: q.tx!.data, value: toHex(BigInt(q.tx!.value || "0")) });

// ---------------------------------------------------------------- orders (quote -> review -> submit)

/** Quotes are re-fetched if the user takes longer than this to confirm the review */
export const QUOTE_TTL_MS = 45_000;

/** A quoted, balance-checked order the user can review before anything is sent to the wallet. */
export interface PreparedOrder {
  side: "buy" | "sell";
  sender: string;
  /** legs that will execute */
  legs: LegQuote[];
  /** legs that could not be routed (with the reason) */
  skipped: LegQuote[];
  /** buy: USDC paid. sell: USD value of the stock sold (aggregator pricing) */
  totalInUsd: number;
  /** estimated USD value received */
  totalOutUsd: number;
  /** sell only: USDC quoted to arrive */
  totalOutUsdc?: number;
  /** value lost to price impact + fees, in % of totalInUsd */
  costPct: number;
  slippageBps: number;
  /** wallet actions: approvals needed now + one swap per leg */
  approvals: number;
  /** shown in the review when the wallet may not be able to pay network fees */
  gasWarning?: string;
  preparedAt: number;
}

function summarize(side: "buy" | "sell", sender: string, legs: LegQuote[], skipped: LegQuote[], approvals: number, slippageBps: number): PreparedOrder {
  // Each leg's cost % comes from the aggregator's own consistent USD pricing. Mixing face-value USDC
  // with aggregator USD (which prices USDC slightly below $1) would overstate the cost, so totals are
  // built from the per-leg cost: buy value received = USDC paid x (1 - cost).
  const legIn = (q: LegQuote) =>
    side === "buy" && !isNative(q.tokenIn) ? Number(q.amountInRaw) / 1e6 : q.amountInUsd ?? 0;
  const totalInUsd = legs.reduce((a, q) => a + legIn(q), 0);
  const costPct = totalInUsd > 0 ? legs.reduce((a, q) => a + legIn(q) * (q.costPct ?? 0), 0) / totalInUsd : 0;
  const totalOutUsdc = side === "sell" ? legs.reduce((a, q) => a + (q.amountOutUsdc ?? 0), 0) : undefined;
  const totalOutUsd = side === "buy" ? legs.reduce((a, q) => a + legIn(q) * (1 - (q.costPct ?? 0) / 100), 0) : totalOutUsdc ?? 0;
  return {
    side,
    sender,
    legs,
    skipped,
    totalInUsd,
    totalOutUsd,
    totalOutUsdc,
    costPct,
    slippageBps,
    approvals,
    preparedAt: Date.now(),
  };
}

/** Warns when an EOA has (almost) no ETH left for gas. Smart wallets may have gas sponsored, so only a note. */
async function gasCheck(eth: EthProvider, sender: string, ethSpent: bigint): Promise<string | undefined> {
  try {
    const [balHex, code] = await Promise.all([
      eth.request({ method: "eth_getBalance", params: [sender, "latest"] }) as Promise<string>,
      (eth.request({ method: "eth_getCode", params: [sender, "latest"] }) as Promise<string>).catch(() => "0x"),
    ]);
    const left = BigInt(balHex) - ethSpent;
    if (left >= MIN_GAS_WEI) return undefined;
    const smart = !!code && code !== "0x";
    return smart
      ? "Low ETH for network fees. If your wallet doesn't cover gas for you, the transaction may fail."
      : ethSpent > 0n
      ? "Leave a little ETH on Base for network fees (about $0.05): lower the amount slightly."
      : "You need a little ETH on Base for network fees (about $0.05). Without it the transaction will fail.";
  } catch {
    return undefined;
  }
}

async function countApprovals(eth: EthProvider, sender: string, legs: LegQuote[]) {
  // Same grouping as buildApprovals; the builder code does not change the count
  return (await buildApprovals(eth, sender, legs, "")).length;
}

export async function quoteLeg(leg: BasketLeg, sender: string, slippageBps = 50): Promise<LegQuote> {
  return postSwap({ side: "buy", stockAddress: leg.b20Address, amountUsd: leg.usd, payWith: leg.payWith || "usdc", sender, slippageBps }, leg.symbol);
}

export async function quoteSellLeg(leg: SellLeg, sender: string, slippageBps = 50): Promise<LegQuote> {
  return postSwap({ side: "sell", stockAddress: leg.b20Address, amountTokens: leg.tokens, sender, slippageBps }, leg.symbol);
}

/** Step 1 (buy): quote every leg and check the USDC balance. Nothing is sent. */
export async function prepareBuy(params: {
  eth: EthProvider;
  sender: string;
  legs: BasketLeg[];
  slippageBps?: number;
  onStatus?: StatusFn;
}): Promise<PreparedOrder> {
  const { eth, sender, legs, slippageBps = 50, onStatus = () => {} } = params;
  await ensureBase(eth, onStatus);
  const quotes = await quoteAll(legs, (l) => quoteLeg(l, sender, slippageBps), "for", onStatus);
  const bought = quotes.filter(usable);
  const skipped = quotes.filter((q) => !bought.includes(q)).map(withSkipReason);
  if (bought.length === 0) throw new Error(skipped.map((s) => `${s.symbol}: ${s.error}`).join(" | ") || "No routes available");

  const usdcIn = bought.filter((q) => !isNative(q.tokenIn)).reduce((acc, q) => acc + BigInt(q.amountInRaw!), 0n);
  const ethIn = bought.filter((q) => isNative(q.tokenIn)).reduce((acc, q) => acc + BigInt(q.amountInRaw!), 0n);
  if (usdcIn > 0n) {
    const balance = await readErc20(eth, USDC_BASE, "balanceOf", [sender as `0x${string}`]);
    if (balance < usdcIn) {
      throw new Error(`Not enough USDC on Base: need ${(Number(usdcIn) / 1e6).toFixed(2)}, have ${(Number(balance) / 1e6).toFixed(2)}. You can pay with ETH instead.`);
    }
  }
  if (ethIn > 0n) {
    const balance = BigInt((await eth.request({ method: "eth_getBalance", params: [sender, "latest"] })) as string);
    if (balance < ethIn) {
      throw new Error(`Not enough ETH on Base: need ${(Number(ethIn) / 1e18).toFixed(6)}, have ${(Number(balance) / 1e18).toFixed(6)}.`);
    }
  }
  const order = summarize("buy", sender, bought, skipped, await countApprovals(eth, sender, bought), slippageBps);
  order.gasWarning = await gasCheck(eth, sender, ethIn);
  return order;
}

/** Step 1 (sell): quote every leg and check the stock balances. Nothing is sent. */
export async function prepareSell(params: {
  eth: EthProvider;
  sender: string;
  legs: SellLeg[];
  slippageBps?: number;
  onStatus?: StatusFn;
}): Promise<PreparedOrder> {
  const { eth, sender, legs, slippageBps = 50, onStatus = () => {} } = params;
  await ensureBase(eth, onStatus);
  const quotes = await quoteAll(legs, (l) => quoteSellLeg(l, sender, slippageBps), "to sell", onStatus);
  const sold = quotes.filter(usable);
  const skipped = quotes.filter((q) => !sold.includes(q)).map(withSkipReason);
  if (sold.length === 0) throw new Error(skipped.map((s) => `${s.symbol}: ${s.error}`).join(" | ") || "No routes available");

  for (const q of sold) {
    const bal = await readErc20(eth, q.tokenIn!, "balanceOf", [sender as `0x${string}`]);
    if (bal < BigInt(q.amountInRaw!)) throw new Error(`Not enough ${q.symbol} in this wallet.`);
  }
  const order = summarize("sell", sender, sold, skipped, await countApprovals(eth, sender, sold), slippageBps);
  order.gasWarning = await gasCheck(eth, sender, 0n);
  return order;
}

/** Step 2: the user confirmed the review. Sends approvals + swaps to the wallet and reads what arrived. */
export async function submitOrder(params: {
  eth: EthProvider;
  order: PreparedOrder;
  builderCode: string;
  onStatus?: StatusFn;
}): Promise<BasketResult> {
  const { eth, order, builderCode, onStatus = () => {} } = params;
  if (Date.now() - order.preparedAt > QUOTE_TTL_MS) throw new Error("Quote expired. Refresh the quote and review again.");
  const { side, sender, legs, skipped } = order;
  await ensureBase(eth, onStatus);

  const approveCalls = await buildApprovals(eth, sender, legs, builderCode);
  const verb = side === "buy" ? "Buy" : "Sell";
  // Native ETH is excluded from the double-trade guard: gas also lowers it, which would stop valid orders
  const spend = [...new Set(legs.map((q) => q.tokenIn!).filter((t) => !isNative(t)))];
  const swapSpend = legs.map((q) => ({ token: q.tokenIn!, amount: BigInt(q.amountInRaw!) }));
  const { mode, txHashes, failed } = await sendCalls(
    eth,
    sender,
    approveCalls,
    legs.map(toSwapCall),
    legs.map((q) => `${verb} ${q.symbol}`),
    onStatus,
    builderCode,
    spend,
    swapSpend
  );
  onStatus("Reading what you received onchain…");
  const watch =
    side === "buy"
      ? legs.map((q) => ({ address: q.b20Address!, symbol: q.symbol, decimals: B20_DECIMALS, quoted: q.amountOutShares }))
      : [{ address: USDC_BASE, symbol: "USDC", decimals: USDC_DECIMALS, quoted: order.totalOutUsdc }];
  const tracked = await trackReceipts(eth, txHashes, sender, watch);
  // A batch can be mined while its swaps revert (non-atomic wallets) -> judge by what actually arrived,
  // but only when every receipt was readable (an RPC hiccup must not be reported as a failed trade)
  if (mode === "batch" && tracked.txs.length > 0 && tracked.txs.every((t) => t.status !== "unknown")) {
    if (side === "buy") {
      for (const q of legs) {
        const got = tracked.received.find((r) => r.b20Address === q.b20Address!.toLowerCase());
        if (!got || got.raw === "0") failed.push({ label: `${verb} ${q.symbol}`, error: "No stock arrived: the swap reverted; only gas was spent" });
      }
    } else if ((tracked.received[0]?.raw ?? "0") === "0") {
      for (const q of legs) failed.push({ label: `${verb} ${q.symbol}`, error: "No USDC arrived: the swap reverted; only gas was spent" });
    }
    if (failed.length === legs.length) throw new Error("The batch was mined but every swap reverted (price moved). Your funds stayed in your wallet; only gas was spent.");
  }
  // Legs that failed are not "bought": keep only the ones that went through
  const failedLabels = new Set(failed.map((f) => f.label));
  const done = legs.filter((q) => !failedLabels.has(`${verb} ${q.symbol}`));
  return { side, mode, txHashes, bought: done, skipped, ...tracked, failed };
}

/** Quote + send in one go (no review step). Kept for scripts and backwards compatibility. */
export async function executeBasket(params: {
  eth: EthProvider;
  sender: string;
  legs: BasketLeg[];
  builderCode: string;
  slippageBps?: number;
  onStatus?: StatusFn;
}): Promise<BasketResult> {
  const order = await prepareBuy(params);
  return submitOrder({ eth: params.eth, order, builderCode: params.builderCode, onStatus: params.onStatus });
}

export async function executeSell(params: {
  eth: EthProvider;
  sender: string;
  legs: SellLeg[];
  builderCode: string;
  slippageBps?: number;
  onStatus?: StatusFn;
}): Promise<BasketResult> {
  const order = await prepareSell(params);
  return submitOrder({ eth: params.eth, order, builderCode: params.builderCode, onStatus: params.onStatus });
}
