// Attribution regression test: proves every swap built by /api/swap stays attributed to our
// ERC-8021 Builder Code however the wallet sends it. Indexers read the suffix from the very END of
// the tx input (EOA, EIP-7702) or of the UserOperation callData (ERC-4337 smart wallets).
//
//   npm run test:attribution                       (needs `npm run dev` on :3000)
//   npm run test:attribution -- --url=https://...  (against a deployment)
//
// No transaction is sent. The router check is an eth_call with a simulated USDC balance.
import fs from "node:fs";
import {
  createPublicClient,
  http,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  pad,
  parseAbi,
  toHex,
} from "viem";
import { base } from "viem/chains";
import { Attribution } from "ox/erc8021";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const env = (() => {
  try {
    return Object.fromEntries(
      fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
    );
  } catch {
    return {};
  }
})();

const URL_BASE = arg("url", "http://localhost:3000").replace(/\/$/, "");
const CODE = env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";
const SENDER = arg("sender", "0xD986C711F575C71dA22Bd08742b9DB2091Ba9e33"); // any address works for quotes
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const KYBER_ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const client = createPublicClient({ chain: base, transport: http(env.BASE_RPC_URL || "https://mainnet.base.org") });

const CASES = [
  { label: "buy  NVDAc $5", body: { side: "buy", stockAddress: "0xb20000000000000000000078ee7ce2fE4908108C", amountUsd: 5 } },
  { label: "buy  AAPLc $2.37", body: { side: "buy", stockAddress: "0xb200000000000000000000C2e324d24d7eEcd1fb", amountUsd: 2.37 } },
  { label: "sell NVDAc 0.005", body: { side: "sell", stockAddress: "0xb20000000000000000000078ee7ce2fE4908108C", amountTokens: 0.005 } },
  { label: "buy  NVDAc $2 paid in ETH", body: { side: "buy", payWith: "eth", stockAddress: "0xb20000000000000000000078ee7ce2fE4908108C", amountUsd: 2 } },
];

let failures = 0;
const check = (ok, what) => {
  console.log(`   ${ok ? "✅" : "❌"} ${what}`);
  if (!ok) failures++;
};
const codesOf = (data) => {
  try {
    return Attribution.fromData(data)?.codes ?? [];
  } catch {
    return [];
  }
};
const endsWithCode = (data) => codesOf(data).includes(CODE);

// How wallets wrap a batch [approve, swap] (the executor always puts the swap last)
const callTuple = { type: "tuple[]", components: [{ type: "address" }, { type: "uint256" }, { type: "bytes" }] };
const WRAPPERS = {
  // Seen onchain for UI trades from an EIP-7702 account (self-call, selector 0x3f707e6b)
  "EIP-7702 execute(Call[]) (seen onchain)": (calls) =>
    encodeFunctionData({
      abi: parseAbi(["function execute((address to,uint256 value,bytes data)[] calls)"]),
      functionName: "execute",
      args: [calls.map((c) => ({ to: c.to, value: 0n, data: c.data }))],
    }),
  "EIP-7702 / ERC-7821 execute (mode, data)": (calls) =>
    encodeFunctionData({
      abi: parseAbi(["function execute(bytes32 mode, bytes executionData)"]),
      functionName: "execute",
      args: [`0x01${"00".repeat(31)}`, encodeAbiParameters([callTuple], [calls.map((c) => [c.to, 0n, c.data])])],
    }),
  "ERC-7579 executeBatch (modular accounts)": (calls) =>
    encodeFunctionData({
      abi: parseAbi(["function execute(bytes32 mode, bytes executionCalldata)"]),
      functionName: "execute",
      args: [`0x01${"00".repeat(31)}`, encodeAbiParameters([callTuple], [calls.map((c) => [c.to, 0n, c.data])])],
    }),
  "Coinbase Smart Wallet executeBatch (ERC-4337 callData)": (calls) =>
    encodeFunctionData({
      abi: parseAbi(["function executeBatch((address target,uint256 value,bytes data)[] calls)"]),
      functionName: "executeBatch",
      args: [calls.map((c) => ({ target: c.to, value: 0n, data: c.data }))],
    }),
  "single-call execute(address,uint256,bytes)": (calls) =>
    encodeFunctionData({
      abi: parseAbi(["function execute(address target, uint256 value, bytes data)"]),
      functionName: "execute",
      args: [calls.at(-1).to, 0n, calls.at(-1).data],
    }),
};

async function routerAccepts(q) {
  // Simulate the buy with a USDC balance + allowance written into FiatToken storage (slots 9 and 10)
  const k = (slot, key) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [key, BigInt(slot)]));
  const allowSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [q.routerAddress, k(10, SENDER)]));
  const amount = pad(toHex(BigInt(q.amountInRaw) * 2n), { size: 32 });
  const value = BigInt(q.tx.value || "0");
  await client.call({
    account: SENDER,
    to: q.tx.to,
    data: q.tx.data,
    value,
    stateOverride: [
      { address: USDC, stateDiff: [{ slot: k(9, SENDER), value: amount }, { slot: allowSlot, value: amount }] },
      // paying in ETH: give the sender enough ETH for the value (gas is not charged in eth_call)
      ...(value > 0n ? [{ address: SENDER, balance: value * 2n }] : []),
    ],
  });
}

console.log(`Attribution test — Builder Code ${CODE} — ${URL_BASE}/api/swap\n`);
for (const [i, c] of CASES.entries()) {
  if (i) await new Promise((r) => setTimeout(r, 1500)); // aggregator burst limit
  console.log(`▶ ${c.label}`);
  let q;
  for (let attempt = 0; attempt < 3 && !q?.ok; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 3000));
    q = await fetch(`${URL_BASE}/api/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...c.body, sender: SENDER }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message }));
  }
  if (!q?.ok) {
    check(false, `quote: ${q?.error || "failed"}`);
    continue;
  }
  const data = q.tx.data;
  check(q.routerAddress?.toLowerCase() === KYBER_ROUTER && q.tx.to.toLowerCase() === KYBER_ROUTER, "router is KyberSwap MetaAggregationRouterV2");
  if (c.body.payWith === "eth") check(BigInt(q.tx.value || "0") === BigInt(q.amountInRaw) && BigInt(q.amountInRaw) > 0n, "ETH value equals the amount paid (no approval needed)");
  else check(BigInt(q.tx.value || "0") === 0n, "no ETH value");
  check(endsWithCode(data), "EOA tx input ends with the Builder Code");
  check(((data.length - 2) / 2) % 32 === 0, `swap calldata is 32-byte aligned (${(data.length - 2) / 2} bytes)`);

  const approve = encodeFunctionData({
    abi: parseAbi(["function approve(address,uint256)"]),
    functionName: "approve",
    args: [q.routerAddress, BigInt(q.amountInRaw)],
  });
  // ETH-paid buys have no approval: the batch is the swap alone
  const calls = c.body.payWith === "eth" ? [{ to: q.tx.to, data }] : [{ to: q.tokenIn, data: approve }, { to: q.tx.to, data }];
  for (const [name, wrap] of Object.entries(WRAPPERS)) check(endsWithCode(wrap(calls)), `${name}: outer calldata ends with the Builder Code`);

  if (c.body.side === "buy") {
    try {
      await routerAccepts(q);
      check(true, "router executes the aligned calldata (eth_call, simulated USDC)");
    } catch (e) {
      check(false, `router simulation reverted: ${(e.shortMessage || e.message || "").slice(0, 160)}`);
    }
  }
  console.log("");
}

// Guard: an UNaligned suffix really is hidden by batch padding (keeps this test honest)
const suffix = Attribution.toDataSuffix({ codes: [CODE] });
const unaligned = `0x12345678${suffix.slice(2)}`; // 4 + suffix bytes, not a multiple of 32
console.log("▶ control");
check(!endsWithCode(WRAPPERS["Coinbase Smart Wallet executeBatch (ERC-4337 callData)"]([{ to: USDC, data: unaligned }])), "unaligned suffix is NOT readable after batch padding (test detects the old bug)");

console.log(failures ? `\n❌ ${failures} check(s) failed` : "\n✅ All attribution checks passed");
process.exitCode = failures ? 1 : 0;
