#!/usr/bin/env node
/**
 * Runs contracts/test/RegistrySelfTest.sol: the whole test suite executes inside the
 * test contract's constructor via a single eth_call against Base Mainnet (no deployment,
 * no gas, no funds). A failing check reverts with its name.
 *
 * Usage: npm run test:contracts
 */
import { createPublicClient, http, decodeAbiParameters } from "viem";
import { base } from "viem/chains";
import { compile } from "./compile-contracts.mjs";

const output = compile({
  "contracts/StockMaxxIndexRegistry.sol": "contracts/StockMaxxIndexRegistry.sol",
  "contracts/test/RegistrySelfTest.sol": "contracts/test/RegistrySelfTest.sol",
});
const bytecode = `0x${output.contracts["contracts/test/RegistrySelfTest.sol"]["RegistrySelfTest"].evm.bytecode.object}`;

const client = createPublicClient({
  chain: base,
  transport: http((process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL) || "https://mainnet.base.org", { timeout: 20000 }),
});

try {
  const { data } = await client.call({ data: bytecode, gas: 30_000_000n });
  const [passed] = decodeAbiParameters([{ type: "uint256" }], data);
  console.log(`✅ StockMaxxIndexRegistry: ${passed} checks passed`);
} catch (e) {
  console.error(`❌ Contract test failed: ${e.shortMessage || e.message}`);
  if (e.details) console.error(e.details);
  process.exit(1);
}
