#!/usr/bin/env node
/**
 * Deploys StockMaxxIndexRegistry to Base Mainnet (8453), allowlisting the 10 Coinbase B20 stocks,
 * with the project's ERC-8021 Builder Code appended to the deployment calldata.
 *
 * Requires in .env.local:  DEPLOYER_PRIVATE_KEY=0x...  (use a fresh deployer wallet with a little ETH)
 * Usage: npm run compile:contracts && npm run deploy:mainnet
 */
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, encodeDeployData, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { Attribution } from "ox/erc8021";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0 && !process.env[t.slice(0, i).trim()]) {
      process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
}

const ALLOWED_B20_STOCKS = [
  "0xb20000000000000000000078ee7ce2fE4908108C", // NVDAc
  "0xb200000000000000000000C2e324d24d7eEcd1fb", // AAPLc
  "0xb2000000000000000000001e800a7f5189430cD0", // TSLAc
  "0xB200000000000000000000Ab99cFa739E253872B", // MSFTc
  "0xb2000000000000000000008bC8786B856E61707C", // METAc
  "0xb2000000000000000000002D0BA3164cc74f58B7", // GOOGLc
  "0xb200000000000000000000d9192b6B456483C2E8", // AMZNc
  "0xb2000000000000000000004884b426556b92883d", // MSTRc
  "0xb200000000000000000000397293Cb8cda9a10c5", // SNDKc
  "0xb2000000000000000000007b9fcbd005511aCBd5", // SPCXc
];

const artifactPath = path.join(process.cwd(), "src", "lib", "contracts", "StockMaxxIndexRegistryArtifact.json");
if (!fs.existsSync(artifactPath)) {
  console.error("❌ Artifact not found. Run `npm run compile:contracts` first.");
  process.exit(1);
}
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const rpcUrl = (process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL) || "https://mainnet.base.org";
const builderCode = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";
const pk = process.env.DEPLOYER_PRIVATE_KEY || "";

if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  console.log("⚠️  DEPLOYER_PRIVATE_KEY missing or invalid in .env.local — nothing deployed.");
  process.exit(1);
}

const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== 8453) {
  console.error(`❌ RPC is chain ${chainId}, expected Base Mainnet (8453).`);
  process.exit(1);
}
const balance = await publicClient.getBalance({ address: account.address });
console.log(`Deployer ${account.address} — ${formatEther(balance)} ETH on Base`);
if (balance === 0n) {
  console.error("❌ Deployer has 0 ETH on Base.");
  process.exit(1);
}

const deployData = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [ALLOWED_B20_STOCKS] });
const data = `${deployData}${Attribution.toDataSuffix({ codes: [builderCode] }).slice(2)}`;

console.log(`Deploying StockMaxxIndexRegistry (Builder Code ${builderCode})…`);
const hash = await walletClient.sendTransaction({ data });
console.log(`Tx: https://basescan.org/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  console.error("❌ Deployment failed.");
  process.exit(1);
}
console.log(`✅ Deployed at ${receipt.contractAddress}`);

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
env = /NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS=.*/.test(env)
  ? env.replace(/NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS=.*/, `NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS=${receipt.contractAddress}`)
  : `${env.trim()}\nNEXT_PUBLIC_INDEX_REGISTRY_ADDRESS=${receipt.contractAddress}\n`;
fs.writeFileSync(envPath, env.trim() + "\n");
console.log("Saved NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS to .env.local (restart the dev server).");
