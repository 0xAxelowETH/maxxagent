// Shared by deploy-mainnet.mjs and verify-registry.mjs
import fs from "node:fs";
import path from "node:path";

export const ARTIFACT_PATH = path.join(process.cwd(), "src", "lib", "contracts", "StockMaxxIndexRegistryArtifact.json");
export const SOURCE_PATH = "contracts/StockMaxxIndexRegistry.sol";
export const CONTRACT_ID = `${SOURCE_PATH}:StockMaxxIndexRegistry`;

// Same as src/lib/tokenizedStocks.ts (checked by verify-registry.mjs)
export const ALLOWED_B20_STOCKS = [
  { symbol: "NVDAc", address: "0xb20000000000000000000078ee7ce2fE4908108C" },
  { symbol: "AAPLc", address: "0xb200000000000000000000C2e324d24d7eEcd1fb" },
  { symbol: "TSLAc", address: "0xb2000000000000000000001e800a7f5189430cD0" },
  { symbol: "MSFTc", address: "0xB200000000000000000000Ab99cFa739E253872B" },
  { symbol: "METAc", address: "0xb2000000000000000000008bC8786B856E61707C" },
  { symbol: "GOOGLc", address: "0xb2000000000000000000002D0BA3164cc74f58B7" },
  { symbol: "AMZNc", address: "0xb200000000000000000000d9192b6B456483C2E8" },
  { symbol: "MSTRc", address: "0xb2000000000000000000004884b426556b92883d" },
  { symbol: "SNDKc", address: "0xb200000000000000000000397293Cb8cda9a10c5" },
  { symbol: "SPCXc", address: "0xb2000000000000000000007b9fcbd005511aCBd5" },
];

/** Loads .env.local into process.env (existing variables win). Never prints values. */
export function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0 && !process.env[t.slice(0, i).trim()]) {
      process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
}

/** Solidity standard JSON input identical to scripts/compile-contracts.mjs (needed to verify the source). */
export function standardInput() {
  return {
    language: "Solidity",
    sources: { [SOURCE_PATH]: { content: fs.readFileSync(path.join(process.cwd(), SOURCE_PATH), "utf8") } },
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } },
    },
  };
}
