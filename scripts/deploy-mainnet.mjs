#!/usr/bin/env node
/**
 * Deploys StockMaxxIndexRegistry to Base Mainnet (8453), allowlisting the 10 Coinbase B20 stocks,
 * with the project's ERC-8021 Builder Code appended to the deployment data.
 *
 *   npm run deploy:mainnet                              dry run: checks + simulation + cost, sends NOTHING
 *   npm run deploy:mainnet -- --confirm                 deploys (real transaction)
 *   npm run deploy:mainnet -- --confirm --owner=0x...   deploys, then hands ownership to that address
 *
 * Requires in .env.local: DEPLOYER_PRIVATE_KEY=0x... (a wallet with a little ETH on Base).
 * After deploying: npm run verify:registry (Sourcify; also writes the files for BaseScan's web form).
 */
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, encodeDeployData, encodeFunctionData, formatEther, getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { Attribution } from "ox/erc8021";
import { ALLOWED_B20_STOCKS, ARTIFACT_PATH, loadEnv } from "./registry-common.mjs";

loadEnv();
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const CONFIRM = process.argv.includes("--confirm");
const newOwner = arg("owner");
if (newOwner && !isAddress(newOwner)) {
  console.error("❌ --owner is not a valid address.");
  process.exit(1);
}
if (fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").match(/^NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS=0x[0-9a-fA-F]{40}/m) && CONFIRM) {
  console.error("❌ .env.local already has NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS: a registry is deployed. Remove it first to deploy another.");
  process.exit(1);
}
if (!fs.existsSync(ARTIFACT_PATH)) {
  console.error("❌ Artifact not found. Run `npm run compile:contracts` first.");
  process.exit(1);
}
const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
const rpcUrl = process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
const builderCode = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";
const pk = process.env.DEPLOYER_PRIVATE_KEY || "";
if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  console.log("⚠️  DEPLOYER_PRIVATE_KEY missing or invalid in .env.local — nothing deployed.");
  process.exit(1);
}

const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl, { timeout: 30_000 }) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl, { timeout: 30_000 }) });
const suffix = Attribution.toDataSuffix({ codes: [builderCode] }).slice(2);

const chainId = await publicClient.getChainId();
if (chainId !== 8453) {
  console.error(`❌ RPC is chain ${chainId}, expected Base Mainnet (8453).`);
  process.exit(1);
}
const balance = await publicClient.getBalance({ address: account.address });
console.log(`Deployer ${account.address} — ${formatEther(balance)} ETH on Base`);

// 1) Simulate: the constructor must succeed and produce exactly the compiled runtime code
const data = `${encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [ALLOWED_B20_STOCKS.map((s) => s.address)] })}${suffix}`;
const { data: runtime } = await publicClient.call({ account: account.address, data });
if (runtime !== artifact.deployedBytecode) {
  console.error("❌ Simulation: the deployed code would not match the compiled artifact.");
  process.exit(1);
}
const gas = await publicClient.estimateGas({ account: account.address, data });
const fees = await publicClient.estimateFeesPerGas();
const l2Cost = gas * fees.maxFeePerGas;
console.log(`✅ Simulation OK · gas ${gas} · max L2 fee ${formatEther(l2Cost)} ETH (+ a small L1 data fee)`);
console.log(`   Builder Code ${builderCode} in the deploy data: ${JSON.stringify(Attribution.fromData(data)?.codes)}`);
if (balance < l2Cost * 3n) {
  console.error(`❌ Not enough ETH: keep at least ${formatEther(l2Cost * 3n)} ETH on the deployer.`);
  process.exit(1);
}
if (!CONFIRM) {
  console.log("\nDry run only: nothing was sent. Re-run with --confirm to deploy.");
  process.exit(0);
}

// 2) Deploy
console.log(`\nDeploying StockMaxxIndexRegistry…`);
const hash = await walletClient.sendTransaction({ data, gas: (gas * 12n) / 10n });
console.log(`Tx: https://basescan.org/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
if (receipt.status !== "success" || !receipt.contractAddress) {
  console.error("❌ Deployment failed.");
  process.exit(1);
}
const registry = getAddress(receipt.contractAddress);
console.log(`✅ Deployed at ${registry} (block ${receipt.blockNumber})`);

// Save right away, so a failure below never loses the address
const envPath = path.join(process.cwd(), ".env.local");
let env = fs.readFileSync(envPath, "utf8");
env = /^NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS=.*$/m.test(env)
  ? env.replace(/^NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS=.*$/m, `NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS=${registry}`)
  : `${env.trimEnd()}\nNEXT_PUBLIC_INDEX_REGISTRY_ADDRESS=${registry}\n`;
fs.writeFileSync(envPath, env.trimEnd() + "\n");
fs.writeFileSync(
  path.join(process.cwd(), "contracts", "deployment.base.json"),
  JSON.stringify({ chainId: 8453, address: registry, txHash: hash, block: Number(receipt.blockNumber), deployer: account.address, builderCode, compiler: artifact.compilerVersion }, null, 2) + "\n"
);
console.log("Saved the address to .env.local and contracts/deployment.base.json");

// 3) Post-deploy checks, read from the chain
const read = (functionName, args = []) => publicClient.readContract({ address: registry, abi: artifact.abi, functionName, args });
const problems = [];
if ((await publicClient.getCode({ address: registry })) !== artifact.deployedBytecode) problems.push("runtime code differs from the artifact");
if (getAddress(await read("owner")) !== account.address) problems.push("owner is not the deployer");
if ((await read("indexCount")) !== 0n) problems.push("indexCount is not 0");
for (const s of ALLOWED_B20_STOCKS) if (!(await read("isAllowedToken", [s.address]))) problems.push(`${s.symbol} not allowlisted`);
if (problems.length) {
  console.error(`❌ Post-deploy checks failed: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(`✅ Checks: code matches, owner = deployer, 0 indexes, all ${ALLOWED_B20_STOCKS.length} stocks allowlisted`);

// 4) Optional: hand ownership (allowlist admin only) to another wallet, so the deployer key can be deleted
if (newOwner) {
  const callData = `${encodeFunctionData({ abi: artifact.abi, functionName: "transferOwnership", args: [getAddress(newOwner)] })}${suffix}`;
  const tx = await walletClient.sendTransaction({ to: registry, data: callData });
  const r = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 180_000 });
  const owner = getAddress(await read("owner"));
  if (r.status !== "success" || owner !== getAddress(newOwner)) {
    console.error(`❌ Ownership transfer failed (tx ${tx}). Owner is still ${owner}.`);
    process.exit(1);
  }
  console.log(`✅ Ownership transferred to ${owner} (tx https://basescan.org/tx/${tx})`);
}

console.log(`\nNext:
  1. npm run verify:registry
  2. Vercel env: NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS=${registry} (production), then push once
  3. Remove DEPLOYER_PRIVATE_KEY from .env.local if it is no longer needed`);
