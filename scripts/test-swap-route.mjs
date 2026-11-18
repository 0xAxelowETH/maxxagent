#!/usr/bin/env node
/**
 * MAXXAGENT — Swap route readiness test (no funds spent).
 *
 * For each Coinbase B20 tokenized stock:
 *  1. Gets a USDC -> stock route from the KyberSwap Aggregator (no API key needed)
 *  2. Builds router calldata and appends the ERC-8021 Builder Code suffix
 *  3. Simulates the swap on Base Mainnet with eth_call + state overrides
 *     (fake USDC balance & allowance for a test address), so no real transaction is sent.
 *
 * Usage: node scripts/test-swap-route.mjs [usdAmount=25]
 */
import {
  createPublicClient,
  http,
  encodeAbiParameters,
  keccak256,
  pad,
  toHex,
  decodeFunctionResult,
  parseAbi,
} from "viem";
import { base } from "viem/chains";
import { Attribution } from "ox/erc8021";
import { loadEnv } from "./registry-common.mjs";

loadEnv();

const alignedWithSuffix = (calldata, suffix) => {
  const clean = calldata.replace(/^0x/i, "");
  const sfx = suffix.replace(/^0x/i, "");
  const padBytes = (32 - ((clean.length / 2 + sfx.length / 2) % 32)) % 32;
  return `0x${clean}${"00".repeat(padBytes)}${sfx}`;
};

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TEST_USER = "0x000000000000000000000000000000000000dEaD";
const BUILDER_CODE = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";
const KYBER = "https://aggregator-api.kyberswap.com/base/api/v1";
const usd = Number(process.argv[2] ?? 25);
if (!Number.isFinite(usd) || usd <= 0) {
  console.error("Usage: node scripts/test-swap-route.mjs [usdAmount>0]");
  process.exit(1);
}
const amountIn = BigInt(Math.round(usd * 1e6));

const STOCKS = {
  NVDAc: "0xb20000000000000000000078ee7ce2fE4908108C",
  AAPLc: "0xb200000000000000000000C2e324d24d7eEcd1fb",
  TSLAc: "0xb2000000000000000000001e800a7f5189430cD0",
  MSFTc: "0xB200000000000000000000Ab99cFa739E253872B",
  METAc: "0xb2000000000000000000008bC8786B856E61707C",
  GOOGLc: "0xb2000000000000000000002D0BA3164cc74f58B7",
  AMZNc: "0xb200000000000000000000d9192b6B456483C2E8",
  MSTRc: "0xb2000000000000000000004884b426556b92883d",
  SNDKc: "0xb200000000000000000000397293Cb8cda9a10c5",
  SPCXc: "0xb2000000000000000000007b9fcbd005511aCBd5",
};

const client = createPublicClient({
  chain: base,
  transport: http((process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL) || "https://mainnet.base.org", { timeout: 20000 }),
});

// USDC (FiatTokenV2_2) storage: balanceAndBlacklistStates @ slot 9, allowed @ slot 10
const mapSlot = (key, slot) =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [key, BigInt(slot)]));
const nestedSlot = (owner, spender, slot) =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, mapSlot(owner, slot)]));

const kyberHeaders = { "x-client-id": "maxxagent", "content-type": "application/json" };

async function testStock(symbol, tokenOut) {
  const qRes = await fetch(`${KYBER}/routes?tokenIn=${USDC}&tokenOut=${tokenOut}&amountIn=${amountIn}`, { headers: kyberHeaders });
  if (!qRes.ok) return { symbol, ok: false, reason: `quote HTTP ${qRes.status}` };
  const q = await qRes.json();
  if (q.code !== 0) return { symbol, ok: false, reason: `quote: ${q.message}` };
  const { routeSummary, routerAddress } = q.data;

  const bRes = await fetch(`${KYBER}/route/build`, {
    method: "POST",
    headers: kyberHeaders,
    body: JSON.stringify({
      routeSummary,
      sender: TEST_USER,
      recipient: TEST_USER,
      slippageTolerance: 50, // 0.50% in bps
      source: "maxxagent",
    }),
  });
  if (!bRes.ok) return { symbol, ok: false, reason: `build HTTP ${bRes.status}` };
  const b = await bRes.json();
  if (b.code !== 0) return { symbol, ok: false, reason: `build: ${b.message}` };
  const resolvedRouter = String(b.data.routerAddress || routerAddress || "").toLowerCase();
  if (resolvedRouter !== "0x6131b5fae19ea4f9d964eac0408e4408b66337b5") {
    return { symbol, ok: false, reason: `unexpected router: ${resolvedRouter}` };
  }

  const suffix = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });
  const data = alignedWithSuffix(b.data.data, suffix);

  const venues = [...new Set(routeSummary.route.flat().map((h) => h.exchange))].join("+");
  const outUsd = Number(routeSummary.amountOutUsd);
  const inUsd = Number(routeSummary.amountInUsd) || usd;
  const costPct = ((inUsd - outUsd) / inUsd) * 100; // price impact + fees vs USD value of input

  try {
    const res = await client.call({
      account: TEST_USER,
      to: b.data.routerAddress || routerAddress,
      data,
      stateOverride: [
        {
          address: USDC,
          stateDiff: [
            { slot: mapSlot(TEST_USER, 9), value: pad(toHex(amountIn * 10n)) },
            {
              slot: nestedSlot(TEST_USER, b.data.routerAddress || routerAddress, 10),
              value: pad(toHex(amountIn * 10n)),
            },
          ],
        },
      ],
    });
    let simulatedOut = "?";
    try {
      const [out] = decodeFunctionResult({
        abi: parseAbi(["function f() returns (uint256 returnAmount, uint256 gasUsed)"]),
        functionName: "f",
        data: res.data,
      });
      simulatedOut = (Number(out) / 1e8).toFixed(6);
    } catch {}
    const attributed = Attribution.fromData(data)?.codes?.includes(BUILDER_CODE);
    return { symbol, ok: true, venues, outUsd, costPct, simulatedOut, attributed };
  } catch (e) {
    return { symbol, ok: false, venues, reason: `simulate: ${(e.shortMessage || e.message).slice(0, 120)}` };
  }
}

console.log(`Testing USDC -> B20 stock swaps for $${usd} each (Builder Code: ${BUILDER_CODE})\n`);
let failures = 0;
for (const [symbol, addr] of Object.entries(STOCKS)) {
  // KyberSwap answers "Forbidden" to quick bursts from one client: space the stocks out
  await new Promise((res) => setTimeout(res, 1500));
  const r = await testStock(symbol, addr);
  if (r.ok) {
    const costOk = Number.isFinite(r.costPct) && r.costPct <= 1.5;
    if (!r.attributed || !costOk) failures++;
    const tag = !r.attributed ? " (missing builderCode)" : !costOk ? " (>1.5% cost)" : "";
    console.log(
      `${r.attributed && costOk ? "✅" : "⚠️"} ${symbol.padEnd(7)} out ${r.simulatedOut} sh  ≈ $${r.outUsd.toFixed(2)}  cost ${r.costPct.toFixed(2)}%  via ${r.venues}  builderCode=${r.attributed}${tag}`
    );
  } else {
    failures++;
    console.log(`❌ ${symbol.padEnd(7)} ${r.reason}${r.venues ? `  via ${r.venues}` : ""}`);
  }
  await new Promise((s) => setTimeout(s, 400));
}
if (failures > 0) {
  console.error(`\n❌ ${failures} stock route check(s) failed`);
  process.exitCode = 1;
}
