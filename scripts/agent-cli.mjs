#!/usr/bin/env node
/**
 * MAXXAGENT CLI — prints live Chainlink NAV + B20 multiplier for all 10 Coinbase tokenized stocks
 * and the project's ERC-8021 Builder Code suffix. Read-only: sends no transactions.
 *
 * Usage: npm run agent:cli
 */
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { Attribution } from "ox/erc8021";

const BUILDER_CODE = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";
const STOCKS = [
  ["NVDAc", "0xb20000000000000000000078ee7ce2fE4908108C", "0x04689a41629776563E6822F76f2e57D148d28513"],
  ["AAPLc", "0xb200000000000000000000C2e324d24d7eEcd1fb", "0x787f13dEa48Db0897CbCDD985de77809D837F988"],
  ["TSLAc", "0xb2000000000000000000001e800a7f5189430cD0", "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4"],
  ["MSFTc", "0xB200000000000000000000Ab99cFa739E253872B", "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c"],
  ["METAc", "0xb2000000000000000000008bC8786B856E61707C", "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D"],
  ["GOOGLc", "0xb2000000000000000000002D0BA3164cc74f58B7", "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2"],
  ["AMZNc", "0xb200000000000000000000d9192b6B456483C2E8", "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295"],
  ["MSTRc", "0xb2000000000000000000004884b426556b92883d", "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a"],
  ["SNDKc", "0xb200000000000000000000397293Cb8cda9a10c5", "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA"],
  ["SPCXc", "0xb2000000000000000000007b9fcbd005511aCBd5", "0x6A634B235903C4ad6376892180d6fF8612e3Fa68"],
];

const abi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function uiMultiplier() view returns (uint256)",
]);
const client = createPublicClient({
  chain: base,
  transport: http((process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL) || "https://mainnet.base.org"),
  batch: { multicall: true },
});

const rows = await Promise.all(
  STOCKS.map(async ([symbol, token, feed]) => {
    const [round, mult] = await Promise.all([
      client.readContract({ address: feed, abi, functionName: "latestRoundData" }),
      client.readContract({ address: token, abi, functionName: "uiMultiplier" }).catch(() => 10n ** 18n),
    ]);
    const ageMin = Math.round((Date.now() / 1000 - Number(round[3])) / 60);
    return {
      Symbol: symbol,
      "Chainlink NAV": `$${(Number(round[1]) / 1e8).toFixed(2)}`,
      Multiplier: `${(Number(mult) / 1e18).toFixed(6)}x`,
      "Oracle age": `${ageMin} min`,
    };
  })
);

console.log("MAXXAGENT — live Coinbase tokenized stocks on Base (read-only)\n");
console.table(rows);
console.log(`Builder Code : ${BUILDER_CODE}`);
console.log(`ERC-8021 suffix: ${Attribution.toDataSuffix({ codes: [BUILDER_CODE] })}`);
console.log("\nTo get a basket proposal and buy it, run `npm run dev` and open http://localhost:3000.");
