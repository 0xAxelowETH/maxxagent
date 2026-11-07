import { encodeFunctionData, decodeFunctionResult, parseAbi, toHex } from "viem";
import { appendBuilderCodeToCalldata } from "./builderCode";

/**
 * Non-custodial basket buyer: USDC -> several Coinbase B20 stocks, signed in the user's own wallet.
 * Tries one EIP-5792 batch (wallet_sendCalls); falls back to sequential transactions.
 */

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const BASE_CHAIN_HEX = "0x2105";
const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export interface EthProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export interface BasketLeg {
  symbol: string;
  b20Address: string;
  usd: number;
}

export interface LegQuote {
  ok: boolean;
  symbol: string;
  error?: string;
  routerAddress?: string;
  tx?: { to: string; data: string; value: string };
  amountInRaw?: string;
  amountOutShares?: number;
  b20Address?: string;
  amountOutUsd?: number;
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
  mode: "batch" | "sequential";
  txHashes: string[];
  bought: LegQuote[];
  skipped: LegQuote[];
  /** Actual amounts received, read from onchain Transfer events (not the quote) */
  received: ReceivedAmount[];
  txs: TrackedTx[];
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const B20_DECIMALS = 8;

/** Reads receipts and sums Transfer(to = sender) events per bought token. */
async function trackReceipts(
  eth: EthProvider,
  txHashes: string[],
  sender: string,
  bought: LegQuote[]
): Promise<{ received: ReceivedAmount[]; txs: TrackedTx[] }> {
  const senderTopic = "0x" + sender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const tokens = new Map<string, LegQuote>();
  for (const q of bought) {
    const addr = (q as LegQuote & { b20Address?: string }).b20Address;
    if (addr) tokens.set(addr.toLowerCase(), q);
  }
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
        if (!tokens.has(addr) || log.topics[0] !== TRANSFER_TOPIC) continue;
        if ((log.topics[2] || "").toLowerCase() !== senderTopic) continue;
        sums.set(addr, (sums.get(addr) ?? 0n) + BigInt(log.data));
      }
    } catch {
      txs.push({ hash, status: "unknown" });
    }
  }
  const received: ReceivedAmount[] = [...tokens.entries()].map(([addr, q]) => {
    const raw = sums.get(addr) ?? 0n;
    return {
      symbol: q.symbol,
      b20Address: addr,
      raw: raw.toString(),
      tokens: Number(raw) / 10 ** B20_DECIMALS,
      quotedTokens: q.amountOutShares,
    };
  });
  return { received, txs };
}

type StatusFn = (msg: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function quoteLeg(leg: BasketLeg, sender: string, slippageBps = 50): Promise<LegQuote> {
  try {
    const res = await fetch("/api/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stockAddress: leg.b20Address, amountUsd: leg.usd, sender, slippageBps }),
    });
    const data = await res.json();
    return { ...data, symbol: data?.symbol || leg.symbol };
  } catch (e) {
    return { ok: false, symbol: leg.symbol, error: e instanceof Error ? e.message : "Quote failed" };
  }
}

async function readErc20(eth: EthProvider, data: `0x${string}`, fn: "balanceOf" | "allowance") {
  const raw = (await eth.request({
    method: "eth_call",
    params: [{ to: USDC_BASE, data }, "latest"],
  })) as `0x${string}`;
  return decodeFunctionResult({ abi: ERC20_ABI, functionName: fn, data: raw }) as bigint;
}

async function waitForReceipt(eth: EthProvider, hash: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const receipt = (await eth.request({ method: "eth_getTransactionReceipt", params: [hash] })) as
      | { status?: string }
      | null;
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

export async function executeBasket(params: {
  eth: EthProvider;
  sender: string;
  legs: BasketLeg[];
  builderCode: string;
  slippageBps?: number;
  onStatus?: StatusFn;
}): Promise<BasketResult> {
  const { eth, sender, legs, builderCode, slippageBps = 50, onStatus = () => {} } = params;

  // 1. Base Mainnet only (tokenized stocks live on mainnet)
  const chain = ((await eth.request({ method: "eth_chainId" })) as string)?.toLowerCase();
  if (chain !== BASE_CHAIN_HEX) {
    onStatus("Switching wallet to Base Mainnet…");
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_HEX }] });
  }

  // 2. Quotes (sequential to stay within aggregator rate limits)
  onStatus("Finding best routes…");
  const quotes: LegQuote[] = [];
  for (const [i, leg] of legs.entries()) {
    if (i > 0) await sleep(500); // stay under the aggregator's burst limit
    onStatus(`Finding best route for ${leg.symbol} (${i + 1}/${legs.length})…`);
    quotes.push(await quoteLeg(leg, sender, slippageBps));
  }
  const bought = quotes.filter((q) => q.ok && q.tx && q.routerAddress && q.amountInRaw);
  const skipped = quotes.filter((q) => !bought.includes(q));
  if (bought.length === 0) {
    throw new Error(skipped.map((s) => `${s.symbol}: ${s.error}`).join(" | ") || "No routes available");
  }

  // 3. Balance check
  const totalIn = bought.reduce((acc, q) => acc + BigInt(q.amountInRaw!), 0n);
  const balance = await readErc20(
    eth,
    encodeFunctionData({ abi: ERC20_ABI, functionName: "balanceOf", args: [sender as `0x${string}`] }),
    "balanceOf"
  );
  if (balance < totalIn) {
    throw new Error(
      `Not enough USDC on Base: need ${(Number(totalIn) / 1e6).toFixed(2)}, have ${(Number(balance) / 1e6).toFixed(2)}.`
    );
  }

  // 4. Exact-amount approvals per router (never unlimited)
  const neededByRouter = new Map<string, bigint>();
  for (const q of bought) {
    const r = q.routerAddress!.toLowerCase();
    neededByRouter.set(r, (neededByRouter.get(r) ?? 0n) + BigInt(q.amountInRaw!));
  }
  const approveCalls: { to: string; data: string; value: string }[] = [];
  for (const [router, needed] of neededByRouter) {
    const allowance = await readErc20(
      eth,
      encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [sender as `0x${string}`, router as `0x${string}`],
      }),
      "allowance"
    );
    if (allowance < needed) {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [router as `0x${string}`, needed],
      });
      approveCalls.push({
        to: USDC_BASE,
        data: appendBuilderCodeToCalldata(approveData, builderCode),
        value: "0x0",
      });
    }
  }

  const swapCalls = bought.map((q) => ({
    to: q.tx!.to,
    data: q.tx!.data,
    value: toHex(BigInt(q.tx!.value || "0")),
  }));
  const calls = [...approveCalls, ...swapCalls];

  // 5a. One batch (EIP-5792)
  try {
    onStatus(`Confirm ${calls.length} actions in one wallet prompt…`);
    const sendRes = (await eth.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          chainId: BASE_CHAIN_HEX,
          from: sender,
          atomicRequired: false,
          calls,
        },
      ],
    })) as string | { id: string };
    const batchId = typeof sendRes === "string" ? sendRes : sendRes?.id;

    onStatus("Waiting for confirmation onchain…");
    const start = Date.now();
    while (Date.now() - start < 180_000) {
      const status = (await eth.request({ method: "wallet_getCallsStatus", params: [batchId] })) as {
        status?: number | string;
        receipts?: { transactionHash: string; status?: string }[];
      };
      const done =
        status?.status === 200 || status?.status === "CONFIRMED" || status?.status === "success";
      const failed =
        (typeof status?.status === "number" && status.status >= 400) || status?.status === "failure";
      if (failed) throw new Error("Batch failed onchain. No funds were swapped in failed calls.");
      if (done) {
        const txHashes = [...new Set((status.receipts || []).map((r) => r.transactionHash))];
        onStatus("Reading what you received onchain…");
        const tracked = await trackReceipts(eth, txHashes, sender, bought);
        return { mode: "batch", txHashes, bought, skipped, ...tracked };
      }
      await sleep(2000);
    }
    throw new Error("Timed out waiting for batch confirmation. Check your wallet activity.");
  } catch (err) {
    if (!isUnsupportedMethod(err)) throw err;
  }

  // 5b. Sequential fallback (wallets without EIP-5792)
  const txHashes: string[] = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const isApprove = i < approveCalls.length;
    onStatus(
      isApprove
        ? `Approve USDC (${i + 1}/${calls.length})…`
        : `Buy ${bought[i - approveCalls.length].symbol} (${i + 1}/${calls.length})…`
    );
    const hash = (await eth.request({
      method: "eth_sendTransaction",
      params: [{ from: sender, to: c.to, data: c.data, value: c.value }],
    })) as string;
    txHashes.push(hash);
    await waitForReceipt(eth, hash);
  }
  onStatus("Reading what you received onchain…");
  const tracked = await trackReceipts(eth, txHashes, sender, bought);
  return { mode: "sequential", txHashes, bought, skipped, ...tracked };
}
