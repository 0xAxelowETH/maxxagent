// Checks REAL onchain trades of a wallet for our ERC-8021 Builder Code, the way indexers read it:
//   - EOA / EIP-7702 wallets: suffix at the end of the transaction input (tx.from = wallet)
//   - ERC-4337 smart wallets: suffix at the end of the UserOperation callData inside EntryPoint.handleOps
//
//   npm run verify:trades -- --wallet=0x...            (last 24 hours)
//   npm run verify:trades -- --wallet=0x... --hours=72
//
// Read-only. Uses BASE_RPC_URL from .env.local if set (never printed), otherwise the public Base RPC.
import fs from "node:fs";
import { createPublicClient, decodeFunctionData, http, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { entryPoint06Abi, entryPoint06Address, entryPoint07Abi, entryPoint07Address, entryPoint08Address } from "viem/account-abstraction";
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

const WALLET = arg("wallet", "");
if (!/^0x[a-fA-F0-9]{40}$/.test(WALLET)) {
  console.log("Usage: npm run verify:trades -- --wallet=0xYourWallet [--hours=24]");
  process.exit(1);
}
const HOURS = Math.min(24 * 14, Math.max(1, Number(arg("hours", "24")) || 24));
const CODE = env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";
const w = WALLET.toLowerCase();

const client = createPublicClient({ chain: base, transport: http(env.BASE_RPC_URL || "https://mainnet.base.org", { retryCount: 2 }) });
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const STOCKS = {
  "0xb20000000000000000000078ee7ce2fe4908108c": "NVDAc",
  "0xb200000000000000000000c2e324d24d7eecd1fb": "AAPLc",
  "0xb2000000000000000000001e800a7f5189430cd0": "TSLAc",
  "0xb200000000000000000000ab99cfa739e253872b": "MSFTc",
  "0xb2000000000000000000008bc8786b856e61707c": "METAc",
  "0xb2000000000000000000002d0ba3164cc74f58b7": "GOOGLc",
  "0xb200000000000000000000d9192b6b456483c2e8": "AMZNc",
  "0xb2000000000000000000004884b426556b92883d": "MSTRc",
  "0xb200000000000000000000397293cb8cda9a10c5": "SNDKc",
  "0xb2000000000000000000007b9fcbd005511acbd5": "SPCXc",
};
const TOKENS = [USDC, ...Object.keys(STOCKS)];
const ENTRY_POINTS = new Set([entryPoint06Address, entryPoint07Address, entryPoint08Address].map((a) => a.toLowerCase()));
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const codesOf = (data) => {
  try {
    return Attribution.fromData(data)?.codes ?? [];
  } catch {
    return [];
  }
};

// 1. Every tx that moved USDC or a B20 stock in or out of the wallet
const latest = await client.getBlockNumber();
// Base block time changed (2s -> 0.2s in late Oct 2026): binary-search the block at "now - HOURS"
const target = Math.floor(Date.now() / 1000) - HOURS * 3600;
let lo = 0n;
let hi = latest;
while (hi - lo > 1n) {
  const mid = (lo + hi) / 2n;
  const t = Number((await client.getBlock({ blockNumber: mid })).timestamp);
  if (t < target) lo = mid;
  else hi = mid;
}
const fromBlock = hi;
const CHUNK = 2000n;
const txs = new Map(); // hash -> { block, moves: [] }
process.stdout.write(`Scanning ${HOURS}h of Base blocks for ${WALLET}…`);
for (let start = fromBlock; start <= latest; start += CHUNK) {
  const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
  for (const args of [{ from: WALLET }, { to: WALLET }]) {
    const logs = await client.getLogs({ address: TOKENS, event: TRANSFER, args, fromBlock: start, toBlock: end }).catch(() => null);
    if (logs === null) {
      console.log(`\n⚠️  RPC refused blocks ${start}-${end}; results may be incomplete`);
      continue;
    }
    for (const l of logs) {
      const t = txs.get(l.transactionHash) || { block: l.blockNumber, moves: [] };
      const sym = l.address.toLowerCase() === USDC.toLowerCase() ? "USDC" : STOCKS[l.address.toLowerCase()];
      const dec = sym === "USDC" ? 6 : 8;
      const out = l.args.from.toLowerCase() === w;
      if (Number(l.args.value) > 0) t.moves.push(`${out ? "-" : "+"}${(Number(l.args.value) / 10 ** dec).toFixed(sym === "USDC" ? 2 : 6)} ${sym}`);
      txs.set(l.transactionHash, t);
    }
  }
}
console.log(` ${txs.size} transaction(s) found\n`);

// 2. Classify each tx and read the Builder Code where indexers read it
const rows = [];
for (const [hash, info] of [...txs.entries()].sort((a, b) => Number(a[1].block - b[1].block))) {
  if (info.moves.length === 0) continue; // zero-value spam transfers (address poisoning)
  const tx = await client.getTransaction({ hash });
  const block = await client.getBlock({ blockNumber: tx.blockNumber });
  let kind;
  let codes = [];
  if (tx.from.toLowerCase() === w) {
    kind = tx.to?.toLowerCase() === w || tx.type === "eip7702" ? "EIP-7702 batch" : "EOA";
    codes = codesOf(tx.input);
  } else if (tx.to && ENTRY_POINTS.has(tx.to.toLowerCase())) {
    kind = "ERC-4337 smart wallet";
    for (const abi of [entryPoint07Abi, entryPoint06Abi]) {
      try {
        const { functionName, args } = decodeFunctionData({ abi, data: tx.input });
        if (functionName !== "handleOps") continue;
        const op = args[0].find((o) => o.sender.toLowerCase() === w);
        if (op) codes = codesOf(op.callData);
        break;
      } catch {}
    }
  } else {
    kind = "incoming (sent by someone else)";
  }
  rows.push({ time: new Date(Number(block.timestamp) * 1000), kind, codes, hash, moves: info.moves.join(" ") });
}

const ours = rows.filter((r) => !r.kind.startsWith("incoming"));
for (const r of rows) {
  const status = r.kind.startsWith("incoming") ? "  ·" : r.codes.includes(CODE) ? "  ✅" : "  ❌";
  const code = r.kind.startsWith("incoming") ? "" : r.codes.length ? `code=${r.codes.join(",")}` : "NO builder code";
  console.log(`${status} ${r.time.toISOString().slice(0, 16).replace("T", " ")} UTC  ${r.kind.padEnd(22)} ${code.padEnd(18)} ${r.moves}`);
  console.log(`      https://basescan.org/tx/${r.hash}`);
}
const ok = ours.filter((r) => r.codes.includes(CODE)).length;
console.log(`\n${ok}/${ours.length} trade(s) sent by this wallet carry Builder Code ${CODE} where indexers read it.`);
if (ours.length > ok) {
  console.log("❌ = not attributed. Expected for: trades made outside MAXXAGENT (e.g. a funding swap elsewhere),");
  console.log("   and batched UI trades before the batch-padding fix (commit 6438632, 2026-11-07 13:06 WIB).");
}
process.exitCode = ours.length > ok ? 1 : 0;
