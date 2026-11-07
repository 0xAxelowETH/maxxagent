#!/usr/bin/env node
/**
 * Verifies the deployed StockMaxxIndexRegistry source on Sourcify (free, no API key; Blockscout shows it too)
 * and writes the files for BaseScan's web form ("Solidity (Standard-Json-Input)").
 *
 *   npm run verify:registry                 uses contracts/deployment.base.json (written by deploy:mainnet)
 *   npm run verify:registry -- --check      local checks only (no deployed contract needed)
 */
import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import { createPublicClient, http, encodeAbiParameters, getAddress } from "viem";
import { base } from "viem/chains";
import { ALLOWED_B20_STOCKS, ARTIFACT_PATH, CONTRACT_ID, SOURCE_PATH, loadEnv, standardInput } from "./registry-common.mjs";

loadEnv();
const CHECK_ONLY = process.argv.includes("--check");
const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
const compilerVersion = artifact.compilerVersion.replace(/\.Emscripten.*$/, ""); // e.g. 0.8.38+commit.1835d247

// 1) The standard JSON input must rebuild the exact deployed bytecode (incl. the metadata hash)
const input = standardInput();
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  console.error("❌ Compile errors:", errors.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}
const [file, name] = CONTRACT_ID.split(":");
const rebuilt = `0x${out.contracts[file][name].evm.deployedBytecode.object}`;
if (rebuilt !== artifact.deployedBytecode) {
  console.error("❌ The standard JSON input does not rebuild the artifact. Run `npm run compile:contracts` and redeploy, or fix the settings.");
  process.exit(1);
}
console.log(`✅ Standard JSON input rebuilds the artifact exactly (solc ${solc.version()})`);

// 2) Allowlist = the app's stock list
const meta = fs.readFileSync(path.join(process.cwd(), "src/lib/tokenizedStocks.ts"), "utf8");
for (const s of ALLOWED_B20_STOCKS) {
  if (!new RegExp(`symbol: "${s.symbol}"[\\s\\S]{0,400}?b20Address: "${s.address}"`, "i").test(meta)) {
    console.error(`❌ ${s.symbol} ${s.address} does not match src/lib/tokenizedStocks.ts`);
    process.exit(1);
  }
}
console.log(`✅ Allowlist matches the app's ${ALLOWED_B20_STOCKS.length} stocks`);

// 3) Files for BaseScan's web form
const dir = path.join(process.cwd(), "contracts", "verify");
fs.mkdirSync(dir, { recursive: true });
const args = encodeAbiParameters([{ type: "address[]" }], [ALLOWED_B20_STOCKS.map((s) => s.address)]).slice(2);
fs.writeFileSync(path.join(dir, "StockMaxxIndexRegistry.standard-input.json"), JSON.stringify(input, null, 2));
fs.writeFileSync(path.join(dir, "constructor-args.txt"), args + "\n");
console.log(`✅ Wrote contracts/verify/ (standard JSON input + ABI-encoded constructor args)`);
if (CHECK_ONLY) process.exit(0);

// 4) Sourcify
const depPath = path.join(process.cwd(), "contracts", "deployment.base.json");
const dep = fs.existsSync(depPath) ? JSON.parse(fs.readFileSync(depPath, "utf8")) : null;
const address = dep?.address || process.env.NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS;
if (!address) {
  console.error("❌ No deployed address (contracts/deployment.base.json or NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS).");
  process.exit(1);
}
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org") });
if ((await client.getCode({ address })) !== artifact.deployedBytecode) {
  console.error(`❌ Code at ${address} does not match the artifact.`);
  process.exit(1);
}
const API = "https://sourcify.dev/server";
const res = await fetch(`${API}/v2/verify/8453/${getAddress(address)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ stdJsonInput: input, compilerVersion, contractIdentifier: `${SOURCE_PATH}:StockMaxxIndexRegistry`, creationTransactionHash: dep?.txHash }),
});
const body = await res.json().catch(() => ({}));
if (res.status === 409 || /already/i.test(JSON.stringify(body))) {
  console.log("✅ Already verified on Sourcify");
} else if (!body.verificationId) {
  console.error(`❌ Sourcify refused (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  process.exit(1);
} else {
  let job;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    job = await fetch(`${API}/v2/verify/${body.verificationId}`).then((r) => r.json());
    if (job.isJobCompleted) break;
  }
  if (!job?.isJobCompleted || job.error) {
    console.error(`❌ Sourcify verification failed: ${JSON.stringify(job?.error || job).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`✅ Sourcify: ${job.contract?.match || job.contract?.runtimeMatch} (runtime ${job.contract?.runtimeMatch}, creation ${job.contract?.creationMatch})`);
}
console.log(`   https://repo.sourcify.dev/8453/${getAddress(address)}
   Blockscout: https://base.blockscout.com/address/${getAddress(address)}?tab=contract

BaseScan (web form, free): https://basescan.org/verifyContract?a=${getAddress(address)}
   Compiler type: Solidity (Standard-Json-Input) · Compiler: v${compilerVersion} · License: MIT
   Upload contracts/verify/StockMaxxIndexRegistry.standard-input.json
   Constructor arguments: contents of contracts/verify/constructor-args.txt`);
