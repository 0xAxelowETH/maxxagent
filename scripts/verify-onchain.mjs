import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

const STOCKS = [
  { symbol: "NVDAc", b20: "0xb20000000000000000000078ee7ce2fE4908108C", feed: "0x04689a41629776563E6822F76f2e57D148d28513" },
  { symbol: "AAPLc", b20: "0xb200000000000000000000C2e324d24d7eEcd1fb", feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988" },
  { symbol: "TSLAc", b20: "0xb2000000000000000000001e800a7f5189430cD0", feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4" },
  { symbol: "MSFTc", b20: "0xB200000000000000000000Ab99cFa739E253872B", feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c" },
  { symbol: "METAc", b20: "0xb2000000000000000000008bC8786B856E61707C", feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D" },
  { symbol: "GOOGLc", b20: "0xb2000000000000000000002D0BA3164cc74f58B7", feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2" },
  { symbol: "AMZNc", b20: "0xb200000000000000000000d9192b6B456483C2E8", feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295" },
  { symbol: "MSTRc", b20: "0xb2000000000000000000004884b426556b92883d", feed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a" },
  { symbol: "SNDKc", b20: "0xb200000000000000000000397293Cb8cda9a10c5", feed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA" },
  { symbol: "SPCXc", b20: "0xb2000000000000000000007b9fcbd005511aCBd5", feed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68" },
];

const abi = parseAbi([
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function uiMultiplier() view returns (uint256)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

async function main() {
  console.log("================================================================================");
  console.log("  MAXXAGENT — Live Base Mainnet B20 & Chainlink Total-Return Verification");
  console.log("================================================================================");

  const client = createPublicClient({
    chain: base,
    transport: http((process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL) || "https://mainnet.base.org"),
  });

  let totalTvl = 0;
  const rows = [];

  for (const s of STOCKS) {
    const [name, rawSupply, rawMult, round] = await Promise.all([
      client.readContract({ address: s.b20, abi, functionName: "name" }),
      client.readContract({ address: s.b20, abi, functionName: "totalSupply" }),
      client.readContract({ address: s.b20, abi, functionName: "uiMultiplier" }),
      client.readContract({ address: s.feed, abi, functionName: "latestRoundData" }),
    ]);

    const price = Number(round[1]) / 1e8;
    const supply = Number(rawSupply) / 1e8;
    const mult = Number(rawMult) / 1e18;
    const sharesUI = supply * mult;
    const tvl = sharesUI * price;
    totalTvl += tvl;

    rows.push({
      Symbol: s.symbol,
      Company: name,
      "Chainlink NAV ($)": `$${price.toFixed(2)}`,
      "uiMultiplier (ERC-8056)": `${mult.toFixed(6)}x`,
      "Supply (UI Shares)": sharesUI.toFixed(2),
      "Base TVL ($M)": `$${(tvl / 1e6).toFixed(2)}M`,
    });
  }

  console.table(rows);
  console.log(`\nTotal Verified Base B20 Tokenized Stock TVL: $${(totalTvl / 1e6).toFixed(2)}M USD`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

