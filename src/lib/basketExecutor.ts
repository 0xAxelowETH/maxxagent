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

function withTimeout<T>(promise: Promise<T>, ms: number, label = "RPC request timed out"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Normalizes any wallet chainId representation (number 8453, decimal "8453", CAIP-2 "eip155:8453",
 * padded "0x02105", or uppercase "0X2105") to canonical lowercase hex ("0x2105").
 */
export function normalizeChainHex(raw: unknown): string {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return "0x" + Math.trunc(raw).toString(16);
  }
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  const cleaned = s.startsWith("eip155:") ? s.slice(7) : s;
  if (/^0x[0-9a-f]+$/.test(cleaned)) {
    try {
      return "0x" + BigInt(cleaned).toString(16);
    } catch {
      return cleaned;
    }
  }
  if (/^\d+$/.test(cleaned)) {
    try {
      return "0x" + BigInt(cleaned).toString(16);
    } catch {
      return cleaned;
    }
  }
  return cleaned;
}

export function isBaseMainnetChain(raw: unknown): boolean {
  return normalizeChainHex(raw) === BASE_CHAIN_HEX;
}

const PUBLIC_BASE_RPCS = ["https://base-rpc.publicnode.com", "https://mainnet.base.org"];

async function basePublicRpc(method: string, params: unknown[]): Promise<unknown> {
  let lastErr: unknown;
  for (const url of PUBLIC_BASE_RPCS) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        ...(ctrl ? { signal: ctrl.signal } : {}),
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message || `RPC HTTP ${res.status}`);
      if (json.error) throw new Error(json.error.message || "RPC error");
      if (json.result === undefined) throw new Error("Empty RPC response");
      return json.result;
    } catch (e) {
      lastErr = e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("Base RPC unavailable");
}

async function readAllowancePublic(token: string, owner: string, spender: string): Promise<bigint | null> {
  try {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner as `0x${string}`, spender as `0x${string}`],
    });
    const raw = (await basePublicRpc("eth_call", [{ to: token, data }, "latest"])) as `0x${string}`;
    return decodeFunctionResult({ abi: ERC20_ABI, functionName: "allowance", data: raw }) as bigint;
  } catch {
    return null;
  }
}

async function readErc20Public(token: string, owner: string): Promise<bigint | null> {
  try {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "balanceOf", args: [owner as `0x${string}`] });
    const raw = (await basePublicRpc("eth_call", [{ to: token, data }, "latest"])) as `0x${string}`;
    return decodeFunctionResult({ abi: ERC20_ABI, functionName: "balanceOf", data: raw }) as bigint;
  } catch {
    return null;
  }
}

/**
 * Read-only JSON-RPC call: tries the connected wallet provider first (with a 4s timeout so a backgrounded
 * mobile/extension bridge never hangs), and falls back to public Base Mainnet RPC on timeout, error, or null receipt.
 */
async function rpcRead(eth: EthProvider, method: string, params: unknown[]): Promise<unknown> {
  try {
    const res = await withTimeout(eth.request({ method, params }), 4000);
    if (res !== null && res !== undefined && res !== "0x") return res;
  } catch {
    // Fall through to public Base Mainnet RPC
  }
  return basePublicRpc(method, params);
}

function extractBatchId(sendRes: unknown): string | undefined {
  if (typeof sendRes === "string" && sendRes.trim()) return sendRes.trim();
  if (typeof sendRes === "object" && sendRes !== null) {
    const o = sendRes as Record<string, unknown>;
    const candidate = o.id ?? o.batchId ?? o.bundleId ?? o.hash ?? o.result;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

type CallsStatusReceipt = { transactionHash?: string; hash?: string; txHash?: string; status?: string | number };
type CallsStatusResponse = { status?: number | string; receipts?: CallsStatusReceipt[] };

function parseCallsStatus(status: CallsStatusResponse | undefined) {
  const rawStatus = status?.status;
  const statusStr = String(rawStatus ?? "").trim().toLowerCase();
  const receipts = Array.isArray(status?.receipts) ? status!.receipts! : [];
  const txHashes = [
    ...new Set(
      receipts
        .map((r) => r?.transactionHash || r?.hash || r?.txHash || "")
        .filter((h): h is string => /^0x[0-9a-fA-F]{64}$/.test(h))
    ),
  ];
  const anyRevertedReceipt = receipts.some((r) => r?.status === "0x0" || r?.status === 0 || r?.status === "reverted");
  const allReceiptsReverted = receipts.length > 0 && receipts.every((r) => r?.status === "0x0" || r?.status === 0 || r?.status === "reverted");
  const isPending =
    rawStatus === 100 || /^(100|pending|queued|submitted|processing|bundling|in_progress|broadcasted)$/.test(statusStr);
  const isFailed =
    (typeof rawStatus === "number" && rawStatus >= 400 && rawStatus !== 600) ||
    /^(400|500|fail|failed|failure|revert|reverted|rejected|dropped|cancelled|canceled)$/.test(statusStr) ||
    allReceiptsReverted;
  const isDone =
    !isFailed &&
    (rawStatus === 200 ||
      rawStatus === 600 ||
      /^(200|600|confirmed|success|succeeded|completed|complete|mined|included)$/.test(statusStr) ||
      (!isPending && txHashes.length > 0));
  return { isPending, isFailed, isDone, anyRevertedReceipt, txHashes };
}

// ---------------------------------------------------------------- helpers

async function readErc20(eth: EthProvider, token: string, fn: "balanceOf" | "allowance", args: readonly `0x${string}`[]) {
  const data =
    fn === "balanceOf"
      ? encodeFunctionData({ abi: ERC20_ABI, functionName: "balanceOf", args: [args[0]] })
      : encodeFunctionData({ abi: ERC20_ABI, functionName: "allowance", args: [args[0], args[1]] });
  const raw = (await rpcRead(eth, "eth_call", [{ to: token, data }, "latest"])) as `0x${string}`;
  return decodeFunctionResult({ abi: ERC20_ABI, functionName: fn, data: raw }) as bigint;
}

async function firstReceipt(eth: EthProvider, hash: string): Promise<RpcReceipt | null> {
  const fromWallet = withTimeout(eth.request({ method: "eth_getTransactionReceipt", params: [hash] }), 2500).then((r) =>
    r && typeof r === "object" ? (r as RpcReceipt) : Promise.reject(new Error("null"))
  );
  const fromPublic = basePublicRpc("eth_getTransactionReceipt", [hash]).then((r) =>
    r && typeof r === "object" ? (r as RpcReceipt) : Promise.reject(new Error("null"))
  );
  return Promise.any([fromWallet, fromPublic]).catch(() => null);
}

async function waitForReceipt(eth: EthProvider, hash: string, timeoutMs = 120_000) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`Invalid transaction hash from wallet: ${hash}`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // Race wallet provider and public Base RPC so a fast wallet response never blocks on throttled public RPC
      const receipt = await firstReceipt(eth, hash);
      if (receipt) {
        if (receipt.status !== undefined && receipt.status !== null && BigInt(receipt.status) !== 1n) {
          throw new Error(`Transaction ${hash} reverted`);
        }
        return;
      }
    } catch (e) {
      if (e instanceof Error && /reverted/i.test(e.message)) throw e;
    }
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for ${hash}`);
}

function hasErrorCode(err: unknown, targetCode: number, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as Record<string, unknown>;
  if (e.code === targetCode) return true;
  return (
    hasErrorCode(e.data, targetCode, depth + 1) ||
    hasErrorCode(e.originalError, targetCode, depth + 1) ||
    hasErrorCode(e.cause, targetCode, depth + 1)
  );
}

function extractErrorMessages(err: unknown, depth = 0, out: string[] = []): string[] {
  if (err == null || depth > 4) return out;
  if (typeof err === "string") {
    if (err.trim()) out.push(err);
    return out;
  }
  if (typeof err !== "object") return out;
  const e = err as Record<string, unknown>;
  for (const k of ["shortMessage", "message", "reason"] as const) {
    if (typeof e[k] === "string" && (e[k] as string).trim()) out.push(e[k] as string);
  }
  extractErrorMessages(e.data, depth + 1, out);
  extractErrorMessages(e.originalError, depth + 1, out);
  extractErrorMessages(e.cause, depth + 1, out);
  return out;
}

function errorMessageText(err: unknown): string {
  const parts = extractErrorMessages(err);
  if (parts.length > 0) return parts.join(" | ");
  if (err && typeof err === "object") return "Wallet request failed";
  return String(err ?? "failed");
}

function isUnsupportedMethod(err: unknown) {
  return (
    hasErrorCode(err, 4200) ||
    hasErrorCode(err, -32601) ||
    /not supported|unsupported|does not exist|unknown method|method not found|missing or invalid|wallet_sendcalls|not approved by the wallet/i.test(
      errorMessageText(err)
    )
  );
}

function isChainMissingError(err: unknown) {
  return hasErrorCode(err, 4902) || /unrecognized chain|unknown chain|chain.*not.*added|\b4902\b/i.test(errorMessageText(err));
}

async function ensureBase(eth: EthProvider, onStatus: StatusFn) {
  const rawChain = await withTimeout(eth.request({ method: "eth_chainId" }), 4000).catch(() => "");
  const chain = normalizeChainHex(rawChain);
  if (!chain) {
    throw new Error("Could not verify your wallet network. Make sure your wallet is on Base Mainnet and try again.");
  }
  if (chain !== BASE_CHAIN_HEX) {
    onStatus("Switching wallet to Base Mainnet…");
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_HEX }] });
    } catch (err) {
      if (isChainMissingError(err)) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: BASE_CHAIN_HEX,
              chainName: "Base Mainnet",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://mainnet.base.org"],
              blockExplorerUrls: ["https://basescan.org"],
            },
          ],
        });
      } else {
        throw err;
      }
    }
    const postRaw = await withTimeout(eth.request({ method: "eth_chainId" }), 3000).catch(() => "");
    if (normalizeChainHex(postRaw) !== BASE_CHAIN_HEX) {
      throw new Error("Please switch your wallet network to Base Mainnet (8453) and try again.");
    }
  }
}

type RpcReceipt = {
  status?: string;
  gasUsed?: string;
  blockNumber?: string;
  logs?: { address: string; topics: string[]; data: string }[];
};

/** Reads receipts and sums Transfer(to = sender) events for the given tokens, plus outgoing Transfer tokens. */
async function trackReceipts(
  eth: EthProvider,
  txHashes: string[],
  sender: string,
  watch: { address: string; symbol: string; decimals: number; quoted?: number }[]
): Promise<{ received: ReceivedAmount[]; txs: TrackedTx[]; spentTokens: Set<string> }> {
  const senderTopic = "0x" + sender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const byAddr = new Map(watch.map((w) => [w.address.toLowerCase(), w]));
  const sums = new Map<string, bigint>();
  const spentTokens = new Set<string>();
  const txs: TrackedTx[] = [];
  for (const hash of txHashes) {
    try {
      let r: RpcReceipt | null = null;
      for (let attempt = 0; attempt < 3 && !r; attempt++) {
        if (attempt > 0) await sleep(800);
        const [publicRec, walletRec] = await Promise.all([
          withTimeout(basePublicRpc("eth_getTransactionReceipt", [hash]), 2000).catch(() => null),
          withTimeout(eth.request({ method: "eth_getTransactionReceipt", params: [hash] }), 2000).catch(() => null),
        ]);
        r = (publicRec || walletRec) as RpcReceipt | null;
      }
      if (!r) {
        txs.push({ hash, status: "unknown" });
        continue;
      }
      const st = r.status !== undefined && r.status !== null ? BigInt(r.status) : null;
      txs.push({
        hash,
        status: st === 1n ? "confirmed" : st === 0n ? "failed" : "unknown",
        gasUsed: r.gasUsed ? BigInt(r.gasUsed).toString() : undefined,
        blockNumber: r.blockNumber ? Number(BigInt(r.blockNumber)) : undefined,
      });
      for (const log of r.logs || []) {
        if ((log.topics[0] || "").toLowerCase() !== TRANSFER_TOPIC) continue;
        const addr = log.address.toLowerCase();
        if ((log.topics[1] || "").toLowerCase() === senderTopic) {
          spentTokens.add(addr);
        }
        if (!byAddr.has(addr)) continue;
        if ((log.topics[2] || "").toLowerCase() !== senderTopic) continue;
        const amt = log.data && log.data !== "0x" ? BigInt(log.data) : 0n;
        sums.set(addr, (sums.get(addr) ?? 0n) + amt);
      }
    } catch {
      txs.push({ hash, status: "unknown" });
    }
  }
  const received: ReceivedAmount[] = [...byAddr.entries()].map(([addr, w]) => {
    const raw = sums.get(addr) ?? 0n;
    return { symbol: w.symbol, b20Address: addr, raw: raw.toString(), tokens: Number(raw) / 10 ** w.decimals, quotedTokens: w.quoted };
  });
  return { received, txs, spentTokens };
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
  return (
    hasErrorCode(err, 4001) ||
    /user (rejected|denied|cancel)|rejected by (the )?user|request rejected|denied transaction|cancell?ed|dibatalkan|ditolak|batal/i.test(
      errorMessageText(err)
    )
  );
}

const shortError = (err: unknown) => {
  const m = extractErrorMessages(err)[0] ?? (err instanceof Error && err.message ? err.message : errorMessageText(err));
  if (/reverted/i.test(m)) return "Swap reverted onchain (price moved or liquidity changed); only gas was spent";
  // Not a failure: it may still confirm. Saying "failed" could make the user buy again.
  if (/timed out waiting for 0x[0-9a-f]{64}/i.test(m)) return "Still pending after 2 minutes: check BaseScan before retrying";
  return m.slice(0, 140);
};

export interface FailedLeg {
  label: string;
  error: string;
}

export interface WalletHint {
  name?: string;
  rdns?: string;
  external?: "coinbase" | "walletconnect" | "browser";
}

/**
 * Mobile/multi-chain wallets like Bitget Wallet (BitKeep), OKX Wallet, and Binance Web3 MPC Wallet can
 * return stub batchIds, throw non-standard errors, or reject `wallet_sendCalls` with 4001 ("Transaksi dibatalkan")
 * instead of -32601. Skip EIP-5792 batching on those providers and go straight to `eth_sendTransaction`.
 */
function preferSequentialWallet(eth: EthProvider, hint?: WalletHint): boolean {
  if (hint?.external === "coinbase") return false;
  const p = eth as {
    isBitKeep?: boolean;
    isBitgetWallet?: boolean;
    isOkxWallet?: boolean;
    isOKExWallet?: boolean;
    isBinance?: boolean;
    isBinanceWeb3?: boolean;
    providerInfo?: { name?: string; rdns?: string };
    session?: { peer?: { metadata?: { name?: string; url?: string } } };
  };
  if (p?.isBitKeep || p?.isBitgetWallet || p?.isOkxWallet || p?.isOKExWallet || p?.isBinance || p?.isBinanceWeb3) return true;
  if (typeof window !== "undefined") {
    const w = window as unknown as { binancew3w?: { ethereum?: unknown }; okxwallet?: unknown; bitkeep?: { ethereum?: unknown } };
    if ((w.binancew3w?.ethereum && w.binancew3w.ethereum === eth) || w.okxwallet === eth || w.bitkeep?.ethereum === eth) return true;
  }
  const meta = `${hint?.name || ""} ${hint?.rdns || ""} ${p?.providerInfo?.name || ""} ${p?.providerInfo?.rdns || ""} ${p?.session?.peer?.metadata?.name || ""} ${p?.session?.peer?.metadata?.url || ""}`;
  if (/bitkeep|bitget|okx|okex|okapp|binance|w3w/i.test(meta)) return true;
  if (hint?.external !== "walletconnect" && typeof navigator !== "undefined" && /bitkeep|bitget|okx|okex|okapp|binance/i.test(navigator.userAgent || "")) return true;
  return false;
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
  swapSpend: { token: string; amount: bigint }[],
  /** tokens expected to Transfer(to = sender) onchain, used as direct Base RPC fallback if wallet_getCallsStatus hangs */
  receiveTokens: string[] = [],
  walletHint?: WalletHint
): Promise<{ mode: "batch" | "sequential"; txHashes: string[]; failed: FailedLeg[] }> {
  const calls = [...approveCalls, ...swapCalls];
  const balancesOf = () => Promise.all(spend.map((t) => readErc20(eth, t, "balanceOf", [sender as `0x${string}`]).catch(() => null)));
  const ethSpendTotal = swapSpend.filter((s) => isNative(s.token)).reduce((a, b) => a + b.amount, 0n);
  const ethBalanceOf = () =>
    ethSpendTotal > 0n
      ? (rpcRead(eth, "eth_getBalance", [sender, "latest"]) as Promise<string>).then((h) => BigInt(h)).catch(() => null)
      : Promise.resolve(null);
  // Nonce = number of txs this address has sent: covers ETH-paid EOA orders (no token balance to compare)
  const nonceOf = () =>
    (rpcRead(eth, "eth_getTransactionCount", [sender, "latest"]) as Promise<string>).then((n) => BigInt(n)).catch(() => null);
  const uniqueReceive = [...new Set(receiveTokens.map((t) => t.toLowerCase()))];
  const [before, ethBefore, nonceBefore, startBlockHex, receiveBefore] = await Promise.all([
    balancesOf(),
    ethBalanceOf(),
    nonceOf(),
    (withTimeout(basePublicRpc("eth_blockNumber", []), 2000).catch(() => null)) as Promise<string | null>,
    Promise.all(uniqueReceive.map((t) => withTimeout(readErc20Public(t, sender), 2500).catch(() => null))),
  ]);
  const startBlock = startBlockHex ? BigInt(startBlockHex) : null;
  onStatus(`Confirm ${calls.length} action${calls.length > 1 ? "s" : ""} in one wallet prompt…`);
  // Smart wallets (ERC-4337) wrap calls in executeBatch, so the per-call suffix is not at the end of
  // the UserOp callData. Base's documented fix: the optional `dataSuffix` capability, appended by the wallet.
  const base = { version: "2.0.0", chainId: BASE_CHAIN_HEX, from: sender, atomicRequired: false, calls };

  let batchId: string | undefined;
  if (preferSequentialWallet(eth, walletHint)) {
    onStatus("Confirming each step in your wallet…");
  } else {
    try {
      let sendRes: unknown;
      try {
        sendRes = await eth.request({
          method: "wallet_sendCalls",
          params: [{ ...base, capabilities: { dataSuffix: { value: builderSuffix(builderCode), optional: true } } }],
        });
      } catch (capErr) {
        // Non-compliant wallets may reject the optional capability: retry once without it.
        if (!hasErrorCode(capErr, 5700) && !/capabilit/i.test(errorMessageText(capErr))) throw capErr;
        sendRes = await eth.request({ method: "wallet_sendCalls", params: [base] });
      }
      batchId = extractBatchId(sendRes);
    } catch (err) {
      if (isUserRejection(err)) throw err;
      if (!isUnsupportedMethod(err)) {
        // Check whether sender is a pure ERC-4337 smart account (non-EIP-7702 bytecode): UserOps do not advance EOA nonce.
        const code = (await withTimeout(rpcRead(eth, "eth_getCode", [sender, "latest"]), 1500).catch(() => "")) as string;
        const isErc4337Account = typeof code === "string" && code.length > 2 && !code.toLowerCase().startsWith("0xef0100");
        // Unknown error (wallets word "no batching" in many ways). Before sending one by one, make sure the
        // batch did not go through anyway: if any spent balance or ETH dropped, never resend (no double trade).
        await sleep(5000);
        const [after, nonceAfter, ethAfter] = await Promise.all([balancesOf(), nonceOf(), ethBalanceOf()]);
        const nonceMoved = nonceBefore !== null && nonceAfter !== null && nonceAfter > nonceBefore;
        const ethDropped = ethBefore !== null && ethAfter !== null && ethBefore > ethAfter && ethBefore - ethAfter >= ethSpendTotal;
        if (isErc4337Account || nonceMoved || ethDropped || after.some((a, i) => a !== null && before[i] !== null && a < before[i]!)) {
          throw new Error("Your wallet reported an error, but funds have moved or a batch request may have been submitted. Check your wallet activity before retrying.");
        }
      }
      onStatus("Your wallet doesn't support one-prompt batches: confirming each step…");
    }
  }

  if (batchId) {
    // The batch was submitted: from here on, never resend the calls (that would double the trade).
    onStatus("Waiting for confirmation onchain…");
    const start = Date.now();
    const senderTopic = "0x" + sender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    let misses = 0;
    let statusUnsupported = false;
    let firstTransferSeenAt = 0;
    let firstDoneWithoutHashesAt = 0;
    while (Date.now() - start < 180_000) {
      let status: CallsStatusResponse | undefined;
      try {
        status = (await withTimeout(
          eth.request({ method: "wallet_getCallsStatus", params: [batchId] }),
          4500,
          "wallet_getCallsStatus timeout"
        )) as CallsStatusResponse | undefined;
        if (status && (status.status !== undefined || (Array.isArray(status.receipts) && status.receipts.length > 0))) {
          misses = 0;
        }
      } catch (statusErr) {
        misses++;
        if (isUnsupportedMethod(statusErr)) {
          statusUnsupported = true;
        }
      }
      const parsed = parseCallsStatus(status);
      if (parsed.isFailed) throw new Error("Batch failed onchain. Nothing was swapped in the failed calls.");
      if (parsed.isDone && parsed.txHashes.length > 0) {
        return { mode: "batch", txHashes: parsed.txHashes, failed: [] };
      }

      // Fallback 1: Some EIP-7702 / EOA / mobile wallets return the 32-byte L2 transaction hash directly as batchId
      if (/^0x[0-9a-fA-F]{64}$/.test(batchId)) {
        const directReceipt = (await basePublicRpc("eth_getTransactionReceipt", [batchId]).catch(() => null)) as { status?: string } | null;
        if (directReceipt) {
          if (directReceipt.status === "0x0") throw new Error("Batch failed onchain. Nothing was swapped in the failed calls.");
          if (directReceipt.status === "0x1") return { mode: "batch", txHashes: [batchId], failed: [] };
        }
      }

      // Fallback 2: Direct Base Mainnet Transfer log + balanceOf check.
      // For multi-leg SELL batches sharing one receive token (USDC_BASE), watch each sold stock's Transfer(from = sender)
      // so leg 1 completing never prematurely ends legs 2..N.
      const spendStocks = [...new Set(swapSpend.map((s) => s.token.toLowerCase()).filter((t) => !isNative(t)))];
      const watchSellSpend = swapCalls.length > 1 && uniqueReceive.length === 1 && uniqueReceive[0] === USDC_BASE.toLowerCase() && spendStocks.length > 1;
      const targetTokens = watchSellSpend ? spendStocks : uniqueReceive;
      let foundHashes: string[] = [];
      const fallbackActive = !parsed.isPending || misses > 0 || statusUnsupported || Date.now() - start >= 25_000;
      if (targetTokens.length > 0 && fallbackActive && (Date.now() - start >= 2000 || misses > 0 || parsed.isDone)) {
        try {
          const latestHex = (await basePublicRpc("eth_blockNumber", []).catch(() => null)) as string | null;
          const latest = latestHex ? BigInt(latestHex) : null;
          const minFrom = startBlock !== null ? startBlock + 1n : null;
          const scanFrom =
            minFrom !== null
              ? latest !== null && latest - minFrom > 1500n
                ? latest - 1500n
                : minFrom
              : latest !== null
              ? latest > 15n
                ? latest - 15n
                : 0n
              : null;
          if (scanFrom !== null && (latest === null || latest >= scanFrom)) {
            const logs = (await basePublicRpc("eth_getLogs", [
              {
                address: targetTokens,
                fromBlock: toHex(scanFrom),
                toBlock: "latest",
                topics: watchSellSpend ? [TRANSFER_TOPIC, senderTopic, null] : [TRANSFER_TOPIC, null, senderTopic],
              },
            ])) as { address?: string; transactionHash?: string }[] | null;
            if (Array.isArray(logs) && logs.length > 0) {
              foundHashes = [
                ...new Set(logs.map((l) => l?.transactionHash || "").filter((h): h is string => /^0x[0-9a-fA-F]{64}$/.test(h))),
              ];
              const foundTokens = new Set(logs.map((l) => (l?.address || "").toLowerCase()).filter(Boolean));
              if (foundHashes.length > 0) {
                if (!firstTransferSeenAt) firstTransferSeenAt = Date.now();
                if (foundTokens.size >= targetTokens.length || parsed.isDone || Date.now() - firstTransferSeenAt >= 12_000) {
                  return { mode: "batch", txHashes: foundHashes, failed: [] };
                }
              }
            }
          }
        } catch {
          // Ignore transient log query errors and check balanceOf below
        }

        // Balance-delta check only keeps us waiting until logs/receipts resolve; never return txHashes: []
        const receiveNow = await Promise.all(uniqueReceive.map((t) => readErc20Public(t, sender)));
        const receivedMore = receiveNow.some((now, i) => now !== null && receiveBefore[i] !== null && now > receiveBefore[i]!);
        if (receivedMore) {
          if (!firstTransferSeenAt) firstTransferSeenAt = Date.now();
          if (foundHashes.length > 0 && (parsed.isDone || (!watchSellSpend && uniqueReceive.length === 1) || Date.now() - firstTransferSeenAt >= 12_000)) {
            return { mode: "batch", txHashes: foundHashes, failed: [] };
          }
          if (foundHashes.length === 0 && Date.now() - firstTransferSeenAt >= 8000) {
            throw new Error("Funds arrived onchain, but transaction hashes could not be read from RPC. Check your wallet activity.");
          }
        }
      }

      if (parsed.isDone) {
        if (!firstDoneWithoutHashesAt) firstDoneWithoutHashesAt = Date.now();
        if (Date.now() - firstDoneWithoutHashesAt >= 5000) {
          throw new Error("Batch finished without confirmed transaction hashes (some or all swaps may have reverted). Check your wallet activity.");
        }
      }

      if ((statusUnsupported && Date.now() - start > 45_000) || (misses > 15 && Date.now() - start > 60_000)) {
        throw new Error("Batch was sent, but status is unavailable. Check your wallet activity before retrying.");
      }
      await sleep(2000);
    }
    if (Date.now() - start >= 180_000) {
      throw new Error("Timed out waiting for batch confirmation. Check your wallet activity before retrying.");
    }
  }

  // One by one. Approvals first (a failed approval stops everything: nothing has been swapped yet).
  const txHashes: string[] = [];
  for (let i = 0; i < approveCalls.length; i++) {
    const c = approveCalls[i];
    onStatus(`Approve (${i + 1}/${calls.length})…`);
    // Extract (spender, amount) from approve(address,uint256) calldata so we can detect onchain confirmation
    // even if a mobile wallet WebView drops the eth_sendTransaction Promise callback after the user confirms.
    const cleanHex = c.data.replace(/^0x/i, "");
    const spender = cleanHex.length >= 136 ? `0x${cleanHex.slice(32, 72)}` : "";
    const targetAmt = cleanHex.length >= 136 ? BigInt(`0x${cleanHex.slice(72, 136)}`) : 0n;
    let settled = false;
    const sendPromise = eth
      .request({ method: "eth_sendTransaction", params: [{ from: sender, to: c.to, data: c.data, value: c.value }] })
      .then((raw) => ({ kind: "hash" as const, hash: extractBatchId(raw) || String(raw || "") }));
    // Prevent late wallet rejections from becoming unhandled after watchAllowance wins Promise.race
    sendPromise.catch(() => {});
    const watchAllowance = (async () => {
      await sleep(4000);
      const started = Date.now();
      while (!settled && spender && targetAmt > 0n && Date.now() - started < 120_000) {
        const current = await readAllowancePublic(c.to, sender, spender);
        if (current !== null && current >= targetAmt) return { kind: "onchain" as const };
        await sleep(2000);
      }
      if (!settled) throw new Error("Timed out waiting for approval confirmation in your wallet. Please retry.");
      return new Promise<never>(() => {});
    })();
    try {
      const outcome = await Promise.race([sendPromise, watchAllowance]);
      settled = true;
      if (outcome.kind === "hash") {
        if (!/^0x[0-9a-fA-F]{64}$/.test(outcome.hash)) throw new Error(`Invalid transaction hash from wallet: ${outcome.hash}`);
        txHashes.push(outcome.hash);
        onStatus(`Confirming approval onchain (${i + 1}/${calls.length})…`);
        await waitForReceipt(eth, outcome.hash);
      }
    } finally {
      settled = true;
    }
  }
  if (approveCalls.length > 0) {
    // Brief pause after approval mines so mobile wallet DApp browsers finish closing the sheet & sync allowance
    onStatus("Approval confirmed — opening swap in wallet…");
    await sleep(900);
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
    let swapSettled = false;
    const targetReceive = uniqueReceive[j] || uniqueReceive[0];
    const isSellLeg = !isNative(token) && targetReceive?.toLowerCase() === USDC_BASE.toLowerCase();
    const watchToken = isSellLeg ? token.toLowerCase() : targetReceive;
    const senderTopic = "0x" + sender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const legBlockHex = (await withTimeout(basePublicRpc("eth_blockNumber", []), 1200).catch(() => null)) as string | null;
    const legStartBlock = legBlockHex ? BigInt(legBlockHex) : startBlock;
    const seenHashes = new Set(txHashes.map((h) => h.toLowerCase()));
    const sendSwapPromise = eth
      .request({ method: "eth_sendTransaction", params: [{ from: sender, to: c.to, data: c.data, value: c.value }] })
      .then((raw) => ({ kind: "hash" as const, hash: extractBatchId(raw) || String(raw || "") }));
    sendSwapPromise.catch(() => {});
    const watchSwapOnchain = (async () => {
      await sleep(5000);
      const started = Date.now();
      while (!swapSettled && Date.now() - started < 120_000) {
        if (legStartBlock !== null && watchToken) {
          try {
            const latestHex = (await basePublicRpc("eth_blockNumber", []).catch(() => null)) as string | null;
            const latest = latestHex ? BigInt(latestHex) : null;
            const minFrom = legStartBlock + 1n;
            if (latest === null || latest >= minFrom) {
              const fromBlock = latest !== null && latest - minFrom > 1500n ? latest - 1500n : minFrom;
              const logs = (await basePublicRpc("eth_getLogs", [
                {
                  address: watchToken,
                  fromBlock: toHex(fromBlock),
                  toBlock: "latest",
                  topics: isSellLeg ? [TRANSFER_TOPIC, senderTopic, null] : [TRANSFER_TOPIC, null, senderTopic],
                },
              ])) as { transactionHash?: string }[] | null;
              const hit = (logs || []).find(
                (l) => /^0x[0-9a-fA-F]{64}$/.test(l?.transactionHash || "") && !seenHashes.has(l.transactionHash!.toLowerCase())
              );
              if (hit?.transactionHash) return { kind: "onchain" as const, hash: hit.transactionHash };
            }
          } catch {}
        }
        await sleep(2500);
      }
      if (!swapSettled) throw new Error(`Timed out waiting for ${labels[j]} in your wallet. If no prompt appeared, open your wallet app or retry.`);
      return new Promise<never>(() => {});
    })();
    try {
      const outcome = await Promise.race([sendSwapPromise, watchSwapOnchain]);
      swapSettled = true;
      hash = outcome.hash;
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`Invalid transaction hash from wallet: ${hash}`);
      txHashes.push(hash);
      if (outcome.kind === "hash") {
        onStatus(`Waiting for ${labels[j]} confirmation…`);
        await waitForReceipt(eth, hash);
      }
      spentSoFar.set(token.toLowerCase(), (spentSoFar.get(token.toLowerCase()) ?? 0n) + amount);
      swapped++;
    } catch (err) {
      swapSettled = true;
      if (isUserRejection(err)) {
        // The user stopped: report this leg and the remaining ones as cancelled
        for (let k = j; k < swapCalls.length; k++) failed.push({ label: labels[k], error: "Cancelled in wallet" });
        break;
      }
      const msg = shortError(err);
      failed.push({ label: labels[j], error: msg });
      if (/timed out waiting/i.test(msg)) {
        for (let k = j + 1; k < swapCalls.length; k++) {
          failed.push({ label: labels[k], error: "Skipped because the previous wallet prompt timed out" });
        }
        break;
      }
    }
  }
  if (swapped === 0) {
    const first = failed[0];
    throw new Error(first?.error === "Cancelled in wallet" ? "Cancelled in wallet. Nothing was swapped." : first?.error || "No swap went through.");
  }
  return { mode: "sequential", txHashes, failed };
}

async function findContractTxBySender(to: string, senderTopic: string, startBlock: bigint): Promise<string | null> {
  const latestHex = (await basePublicRpc("eth_blockNumber", []).catch(() => null)) as string | null;
  const latest = latestHex ? BigInt(latestHex) : null;
  const minFrom = startBlock + 1n;
  if (latest !== null && latest < minFrom) return null;
  const fromBlock = latest !== null && latest - minFrom > 1500n ? latest - 1500n : minFrom;
  const logs = (await basePublicRpc("eth_getLogs", [
    {
      address: to,
      fromBlock: toHex(fromBlock),
      toBlock: "latest",
    },
  ])) as { topics?: string[]; transactionHash?: string }[] | null;
  const mine = (logs || []).find(
    (l) =>
      /^0x[0-9a-fA-F]{64}$/.test(l?.transactionHash || "") &&
      (l.topics || []).some((t) => t.toLowerCase() === senderTopic)
  );
  return mine?.transactionHash || null;
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
  walletHint?: WalletHint;
}): Promise<string> {
  const { eth, sender, to, builderCode, onStatus = () => {}, walletHint } = params;
  const suffix = builderSuffix(builderCode);
  const call = { to, data: alignedWithSuffix(params.data, suffix), value: "0x0" };
  const nonceOf = () =>
    (rpcRead(eth, "eth_getTransactionCount", [sender, "latest"]) as Promise<string>).then((n) => BigInt(n)).catch(() => null);
  await ensureBase(eth, onStatus);
  const [nonceBefore, startBlockHex] = await Promise.all([
    nonceOf(),
    (withTimeout(basePublicRpc("eth_blockNumber", []), 2000).catch(() => null)) as Promise<string | null>,
  ]);
  const startBlock = startBlockHex ? BigInt(startBlockHex) : null;
  onStatus("Confirm in your wallet…");
  const base = { version: "2.0.0", chainId: BASE_CHAIN_HEX, from: sender, atomicRequired: false, calls: [call] };
  let batchId: string | undefined;
  if (preferSequentialWallet(eth, walletHint)) {
    onStatus("Confirming in your wallet…");
  } else {
    try {
      let res: unknown;
      try {
        res = await eth.request({
          method: "wallet_sendCalls",
          params: [{ ...base, capabilities: { dataSuffix: { value: suffix, optional: true } } }],
        });
      } catch (capErr) {
        if (!hasErrorCode(capErr, 5700) && !/capabilit/i.test(errorMessageText(capErr))) throw capErr;
        res = await eth.request({ method: "wallet_sendCalls", params: [base] });
      }
      batchId = extractBatchId(res);
    } catch (err) {
      if (isUserRejection(err)) throw new Error("Cancelled in wallet.");
      if (!isUnsupportedMethod(err)) {
        // Detect ERC-4337 smart accounts (whose UserOps do not move EOA nonce) before fallback resend
        const code = (await withTimeout(rpcRead(eth, "eth_getCode", [sender, "latest"]), 1500).catch(() => "")) as string;
        const isErc4337Account = typeof code === "string" && code.length > 2 && !code.toLowerCase().startsWith("0xef0100");
        // Unknown wallet error: make sure nothing was sent before asking again another way
        await sleep(5000);
        const nonceAfter = await nonceOf();
        if (isErc4337Account || (nonceBefore !== null && nonceAfter !== null && nonceAfter > nonceBefore)) {
          throw new Error("Your wallet reported an error, but a transaction may have been sent. Check your wallet activity before retrying.");
        }
      }
    }
  }

  const senderTopic = "0x" + sender.toLowerCase().replace(/^0x/, "").padStart(64, "0");

  if (batchId) {
    onStatus("Waiting for confirmation onchain…");
    const start = Date.now();
    let misses = 0;
    let statusUnsupported = false;
    while (Date.now() - start < 180_000) {
      let status: CallsStatusResponse | undefined;
      try {
        status = (await withTimeout(
          eth.request({ method: "wallet_getCallsStatus", params: [batchId] }),
          4500,
          "wallet_getCallsStatus timeout"
        )) as CallsStatusResponse | undefined;
        if (status && (status.status !== undefined || (Array.isArray(status.receipts) && status.receipts.length > 0))) {
          misses = 0;
        }
      } catch (statusErr) {
        misses++;
        if (isUnsupportedMethod(statusErr)) {
          statusUnsupported = true;
        }
      }
      const parsed = parseCallsStatus(status);
      if (parsed.isFailed || parsed.anyRevertedReceipt) {
        throw new Error("The transaction failed onchain (only gas was spent).");
      }
      if (parsed.isDone && parsed.txHashes[0]) {
        return parsed.txHashes[0];
      }

      if (/^0x[0-9a-fA-F]{64}$/.test(batchId)) {
        const directReceipt = (await rpcRead(eth, "eth_getTransactionReceipt", [batchId]).catch(() => null)) as { status?: string } | null;
        if (directReceipt) {
          if (directReceipt.status === "0x0") throw new Error("The transaction failed onchain (only gas was spent).");
          if (directReceipt.status === "0x1") return batchId;
        }
      }

      if (startBlock !== null && (Date.now() - start >= 3000 || misses > 0 || parsed.isDone)) {
        try {
          const hit = await findContractTxBySender(to, senderTopic, startBlock);
          if (hit) return hit;
        } catch {}
      }

      if ((statusUnsupported && Date.now() - start > 45_000) || (misses > 15 && (startBlock === null || Date.now() - start > 60_000))) {
        throw new Error("Sent, but the status is unavailable. Check your wallet activity before retrying.");
      }
      await sleep(2000);
    }
    throw new Error("Still pending after 3 minutes: check your wallet activity before retrying.");
  }

  let settled = false;
  const sendTx = eth
    .request({ method: "eth_sendTransaction", params: [{ from: sender, ...call }] })
    .then((raw) => ({ kind: "hash" as const, hash: extractBatchId(raw) || String(raw || "") }));
  sendTx.catch(() => {});
  const watchOnchain = (async () => {
    await sleep(5000);
    const started = Date.now();
    while (!settled && Date.now() - started < 120_000) {
      if (startBlock !== null) {
        try {
          const hit = await findContractTxBySender(to, senderTopic, startBlock);
          if (hit) return { kind: "onchain" as const, hash: hit };
        } catch {}
      }
      await sleep(2500);
    }
    if (!settled) throw new Error("Timed out waiting for transaction confirmation in your wallet. If no prompt appeared, open your wallet app or retry.");
    return new Promise<never>(() => {});
  })();

  let outcome: { kind: "hash" | "onchain"; hash: string };
  try {
    outcome = await Promise.race([sendTx, watchOnchain]);
    settled = true;
  } catch (err) {
    settled = true;
    if (isUserRejection(err)) throw new Error("Cancelled in wallet.");
    throw err;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(outcome.hash)) {
    throw new Error(`Invalid transaction hash from wallet: ${outcome.hash}`);
  }
  if (outcome.kind === "hash") {
    onStatus("Waiting for confirmation onchain…");
    try {
      await waitForReceipt(eth, outcome.hash);
    } catch (err) {
      const m = err instanceof Error ? err.message : "";
      if (/reverted/i.test(m)) throw new Error("The transaction reverted onchain (only gas was spent).");
      if (/timed out/i.test(m)) throw new Error(`Still pending after 2 minutes: check BaseScan (${outcome.hash}) before retrying.`);
      throw err;
    }
  }
  return outcome.hash;
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
export const QUOTE_TTL_MS = 90_000;

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

function summarize(
  side: "buy" | "sell",
  sender: string,
  legs: LegQuote[],
  skipped: LegQuote[],
  approvals: number,
  slippageBps: number,
  preparedAt = Date.now()
): PreparedOrder {
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
    preparedAt,
  };
}

/** Warns when an EOA has (almost) no ETH left for gas. Smart wallets may have gas sponsored, so only a note. */
async function gasCheck(eth: EthProvider, sender: string, ethSpent: bigint): Promise<string | undefined> {
  try {
    const [balHex, code] = await Promise.all([
      rpcRead(eth, "eth_getBalance", [sender, "latest"]) as Promise<string>,
      (rpcRead(eth, "eth_getCode", [sender, "latest"]) as Promise<string>).catch(() => "0x"),
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
  const quoteStartedAt = Date.now();
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
    const balance = BigInt((await rpcRead(eth, "eth_getBalance", [sender, "latest"])) as string);
    if (balance < ethIn) {
      throw new Error(`Not enough ETH on Base: need ${(Number(ethIn) / 1e18).toFixed(6)}, have ${(Number(balance) / 1e18).toFixed(6)}.`);
    }
  }
  const order = summarize("buy", sender, bought, skipped, await countApprovals(eth, sender, bought), slippageBps, quoteStartedAt);
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
  const quoteStartedAt = Date.now();
  const quotes = await quoteAll(legs, (l) => quoteSellLeg(l, sender, slippageBps), "to sell", onStatus);
  const sold = quotes.filter(usable);
  const skipped = quotes.filter((q) => !sold.includes(q)).map(withSkipReason);
  if (sold.length === 0) throw new Error(skipped.map((s) => `${s.symbol}: ${s.error}`).join(" | ") || "No routes available");

  for (const q of sold) {
    const bal = await readErc20(eth, q.tokenIn!, "balanceOf", [sender as `0x${string}`]);
    if (bal < BigInt(q.amountInRaw!)) throw new Error(`Not enough ${q.symbol} in this wallet.`);
  }
  const order = summarize("sell", sender, sold, skipped, await countApprovals(eth, sender, sold), slippageBps, quoteStartedAt);
  order.gasWarning = await gasCheck(eth, sender, 0n);
  return order;
}

/** Step 2: the user confirmed the review. Sends approvals + swaps to the wallet and reads what arrived. */
export async function submitOrder(params: {
  eth: EthProvider;
  order: PreparedOrder;
  builderCode: string;
  onStatus?: StatusFn;
  walletHint?: WalletHint;
}): Promise<BasketResult> {
  const { eth, order, builderCode, onStatus = () => {}, walletHint } = params;
  if (Date.now() - order.preparedAt > QUOTE_TTL_MS) throw new Error("Quote expired. Refresh the quote and review again.");
  const { side, sender, legs, skipped } = order;
  // Ensure Base network before querying allowances so eth_call reads run on the right chain
  await ensureBase(eth, onStatus);
  const approveCalls = await buildApprovals(eth, sender, legs, builderCode);
  const verb = side === "buy" ? "Buy" : "Sell";
  // Native ETH is excluded from the double-trade guard: gas also lowers it, which would stop valid orders
  const spend = [...new Set(legs.map((q) => q.tokenIn!).filter((t) => !isNative(t)))];
  const swapSpend = legs.map((q) => ({ token: q.tokenIn!, amount: BigInt(q.amountInRaw!) }));
  const receiveTokens = side === "buy" ? legs.map((q) => q.b20Address!) : [USDC_BASE];
  const { mode, txHashes, failed } = await sendCalls(
    eth,
    sender,
    approveCalls,
    legs.map(toSwapCall),
    legs.map((q) => `${verb} ${q.symbol}`),
    onStatus,
    builderCode,
    spend,
    swapSpend,
    receiveTokens,
    walletHint
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
    } else {
      for (const q of legs) {
        if (!tracked.spentTokens.has(q.b20Address!.toLowerCase())) {
          failed.push({ label: `${verb} ${q.symbol}`, error: "Stock did not leave wallet: the swap reverted; only gas was spent" });
        }
      }
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
