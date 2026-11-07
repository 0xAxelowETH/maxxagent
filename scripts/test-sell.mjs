#!/usr/bin/env node
/**
 * End-to-end mainnet test SELL through MAXXAGENT's own swap API (stock -> USDC, exact approval, Builder Code).
 *
 *   npm run test:sell                       → DRY RUN: position, quote, approval check. Sends nothing.
 *   npm run test:sell -- --execute          → approve (if needed) + sell, then report USDC actually received.
 * Options: --stock=NVDAc (default) --pct=100 (percent of the position to sell) --url=http://localhost:3000
 *
 * Requires TEST_BUYER_PRIVATE_KEY in .env.local (burner wallet) and `npm run dev` running.
 */
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { Attribution } from "ox/erc8021";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0 && !process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const opt = (name, def) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? def;
const EXECUTE = args.includes("--execute");
const STOCK = opt("stock", "NVDAc");
const PCT = Math.min(100, Math.max(1, Number(opt("pct", "100"))));
const APP = opt("url", "http://localhost:3000").replace(/\/$/, "");
const BUILDER_CODE = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const STOCKS = {
  NVDAc: "0xb20000000000000000000078ee7ce2fE4908108C", AAPLc: "0xb200000000000000000000C2e324d24d7eEcd1fb",
  TSLAc: "0xb2000000000000000000001e800a7f5189430cD0", MSFTc: "0xB200000000000000000000Ab99cFa739E253872B",
  METAc: "0xb2000000000000000000008bC8786B856E61707C", GOOGLc: "0xb2000000000000000000002D0BA3164cc74f58B7",
  AMZNc: "0xb200000000000000000000d9192b6B456483C2E8", MSTRc: "0xb2000000000000000000004884b426556b92883d",
  SNDKc: "0xb200000000000000000000397293Cb8cda9a10c5", SPCXc: "0xb2000000000000000000007b9fcbd005511aCBd5",
};
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const pk = process.env.TEST_BUYER_PRIVATE_KEY || "";
if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  console.error("❌ TEST_BUYER_PRIVATE_KEY missing or invalid in .env.local");
  process.exit(1);
}
const stockAddr = STOCKS[STOCK];
if (!stockAddr) {
  console.error(`❌ Unknown stock ${STOCK}`);
  process.exit(1);
}

const account = privateKeyToAccount(pk);
const rpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const pub = createPublicClient({ chain: base, transport: http(rpc, { timeout: 20000 }) });
const wallet = createWalletClient({ account, chain: base, transport: http(rpc, { timeout: 20000 }) });
const suffix = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });

const [eth, usdcBefore, stockBal] = await Promise.all([
  pub.getBalance({ address: account.address }),
  pub.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [account.address] }),
  pub.readContract({ address: stockAddr, abi: ERC20, functionName: "balanceOf", args: [account.address] }),
]);
console.log(`${EXECUTE ? "🔴 EXECUTE" : "🟢 DRY RUN"} — sell ${PCT}% of ${STOCK} from ${account.address}`);
console.log(`  balances: ${Number(formatEther(eth)).toFixed(6)} ETH | ${formatUnits(usdcBefore, 6)} USDC | ${formatUnits(stockBal, 8)} ${STOCK}`);
if (stockBal === 0n) {
  console.error(`❌ No ${STOCK} in this wallet.`);
  process.exit(1);
}
const sellRaw = (stockBal * BigInt(Math.round(PCT * 100))) / 10_000n;
const sellTokens = Number(sellRaw) / 1e8;

const res = await fetch(`${APP}/api/swap`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ side: "sell", stockAddress: stockAddr, amountTokens: sellTokens, sender: account.address }),
});
const q = await res.json().catch(() => ({}));
if (!q.ok) {
  console.error(`❌ /api/swap: ${q.error || res.status} (is npm run dev running at ${APP}?)`);
  process.exit(1);
}
console.log(`  quote: ${q.amountInTokens} ${STOCK} → ~${q.amountOutUsdc} USDC | cost ${q.costPct.toFixed(2)}% | via ${q.venues.join("+")}`);
console.log(`  router ${q.routerAddress} | Builder Code ${q.builderCode} attached: ${q.tx.data.endsWith("80218021802180218021802180218021")}`);
const allowance = await pub.readContract({ address: stockAddr, abi: ERC20, functionName: "allowance", args: [account.address, q.routerAddress] });
const needsApprove = allowance < BigInt(q.amountInRaw);
console.log(`  approval needed: ${needsApprove ? `yes (exact ${q.amountInTokens} ${STOCK})` : "no"}`);

if (!EXECUTE) {
  console.log("\nNothing was sent. Run with --execute to perform the real test sell.");
  process.exit(0);
}

if (needsApprove) {
  const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [q.routerAddress, BigInt(q.amountInRaw)] }) + suffix.slice(2);
  const h = await wallet.sendTransaction({ to: stockAddr, data });
  console.log(`  approve sent: https://basescan.org/tx/${h}`);
  const r = await pub.waitForTransactionReceipt({ hash: h });
  if (r.status !== "success") throw new Error("approve failed");
}
const swapHash = await wallet.sendTransaction({ to: q.tx.to, data: q.tx.data, value: BigInt(q.tx.value || "0") });
console.log(`  sell sent:    https://basescan.org/tx/${swapHash}`);
const receipt = await pub.waitForTransactionReceipt({ hash: swapHash });
console.log(`  status: ${receipt.status === "success" ? "✅ confirmed" : "❌ reverted"} in block ${receipt.blockNumber}`);
let received = 0n;
for (const log of receipt.logs) {
  if (log.address.toLowerCase() !== USDC.toLowerCase()) continue;
  if (log.topics[0] !== "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") continue;
  if (("0x" + log.topics[2].slice(26)).toLowerCase() !== account.address.toLowerCase()) continue;
  received += BigInt(log.data);
}
console.log(`  received onchain: ${formatUnits(received, 6)} USDC (quoted ~${q.amountOutUsdc})`);
const tx = await pub.getTransaction({ hash: swapHash });
console.log(`  Builder Code in calldata: ${tx.input.endsWith("80218021802180218021802180218021") ? "✅ yes" : "❌ no"}`);
console.log(`\nDone. Sell: https://basescan.org/tx/${swapHash}`);
