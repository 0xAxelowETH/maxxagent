export interface TokenizedStockMetadata {
  symbol: string;
  tickerUnderlying: string;
  name: string;
  companyName: string;
  b20Address: `0x${string}`;
  chainlinkFeed: `0x${string}`;
  decimals: number;
  isin: string;
  sector: "AI & Semiconductors" | "Big Tech Cloud" | "Frontier & Crypto" | "Consumer & Hardware";
  color: string;
  logoUrl: string;
  officialCoinbaseIconUrl: string;
  prospectusUrl: string;
  basescanUrl: string;
  description: string;
  defaultMultiplier: number;
  beta: number;
  aiScoreBase: number;
}

export interface LiveTokenizedStock extends TokenizedStockMetadata {
  navPrice: number;
  dexPrice24_7: number;
  weekendGapPct: number;
  weekendSignal: "BUY_DEX_DISCOUNT" | "SHORT_DEX_PREMIUM" | "FAIR_PARITY";
  dexPairAddress?: string;
  dexId?: string;
  dexLiquidityUsd?: number;
  dexVolume24hUsd?: number;
  dexTxns24h?: number;
  dexUrl?: string;
  dexPriceSource?: "aerodrome-base-live" | "dexscreener-base-live" | "onchain-nav-model";
  navPriceUpdatedAt: string;
  navPriceTimestamp: number;
  oracleAgeMinutes: number;
  isOracleStale: boolean;
  totalSupplyTokens: number;
  totalSupplySharesUI: number;
  uiMultiplier: number;
  onchainMarketCapUsd: number;
  change24hPct: number;
  source:
    | "base-mainnet-onchain"
    | "coinbase-api+onchain"
    | "base-mainnet+aerodrome-dex"
    | "fallback-snapshot";
}

export interface StocksMaxxingPartner {
  id: string;
  name: string;
  handle: string;
  logoUrl: string;
  tracks: string[];
  role: string;
  notionUrl: string;
  telegramUrl?: string;
}

export interface ProgrammableIndexPreset {
  id: string;
  name: string;
  ticker: string;
  tagline: string;
  riskLevel: "Conservative" | "Balanced" | "Aggressive" | "High-Octane";
  rebalanceCadence: string;
  strategyThesis: string;
  allocations: {
    symbol: string;
    weightBps: number; // out of 10,000
    rationale: string;
  }[];
}

/**
 * Official Coinbase Onchain Oracle Registry on Base Mainnet
 * Source: https://docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks
 */
export const COINBASE_ORACLE_REGISTRY_ADDRESS =
  "0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD" as const;

export const COINBASE_TOKENIZED_STOCKS_API_URL =
  "https://api.coinbase.com/v1/tokenized-stocks" as const;

/**
 * Partners of Base Stocks Maxxing Season (informational only — no affiliation implied)
 */
export const STOCKS_MAXXING_PARTNERS: StocksMaxxingPartner[] = [
  {
    id: "base",
    name: "Base",
    handle: "@buildonbase",
    logoUrl: "/logos/partners/base.svg",
    tracks: ["All 3 Official Tracks", "Build in Public"],
    role: "L2 Network & B20 Tokenized Stock Precompile Infrastructure",
    notionUrl: "https://www.base.org/stocksmaxxing",
  },
  {
    id: "bankr",
    name: "Bankr",
    handle: "@bankrbot",
    logoUrl: "/logos/partners/bankr.svg",
    tracks: ["Agentic Stock Finance", "Programmable Stock Markets", "Meme & Community"],
    role: "Autonomous Onchain AI Agent (`api.bankr.bot`), Doppler Stock-Paired Token Launch & TWAP",
    notionUrl: "https://melodic-spandex-01b.notion.site/Bankr-Stocks-Maxxing-40ef95a255db8027866ad73cffdd8506",
    telegramUrl: "https://t.me/+978n2C5uky5iM2Vl",
  },
  {
    id: "basestonk",
    name: "BaseStonk",
    handle: "@BaseStonk",
    logoUrl: "/logos/partners/basestonk-square.svg",
    tracks: ["Agentic Stock Finance", "Programmable Stock Markets", "Meme & Community"],
    role: "Uniswap v4 Tokenized Stock Launchpad & Onchain Holder Reward Routing",
    notionUrl: "https://melodic-spandex-01b.notion.site/Base-Stonk-Stocks-Maxxing-40ef95a255db80818e62eae19ecfcdbc",
    telegramUrl: "https://t.me/+VRYn6XAiP3w0MGE1",
  },
  {
    id: "stonks-exchange",
    name: "Stonks Exchange",
    handle: "@Stonks_Exchange",
    logoUrl: "/logos/partners/stonks-exchange.webp",
    tracks: ["Meme & Community Economies"],
    role: "Aerodrome-Powered Memestock Launchpad & 1:1 Stock Holder-Reward Matching",
    notionUrl: "https://melodic-spandex-01b.notion.site/Stonks-Exchange-Stocks-Maxxing-40ef95a255db808099dec70811a3ba6e",
    telegramUrl: "https://t.me/+owVgfc6IZC81Y2Jl",
  },
  {
    id: "o1-exchange",
    name: "o1 Exchange",
    handle: "@o1_exchange",
    logoUrl: "/logos/partners/o1-exchange-icon.svg",
    tracks: ["Meme & Community Economies"],
    role: "Cross-Market (East & West) Pro Trading Terminal & Launchpad",
    notionUrl: "https://app.notion.com/p/o1-exchange-Launchpad-Ecosystem-3b3d90ea3737808daed4f102443e9665",
    telegramUrl: "https://t.me/+HyzqPXYU_ww0YmE1",
  },
  {
    id: "feel-cash",
    name: "Feel.cash",
    handle: "@feeldotcash",
    logoUrl: "/logos/partners/feel-cash.webp",
    tracks: ["Meme & Community Economies"],
    role: "Community Coin Incubation, Lore Strategy & Social Distribution",
    notionUrl: "https://charmsgg.notion.site/Stock-Maxing-Season-3fb229559adf80109b80f70698eb2c03",
    telegramUrl: "https://t.me/+X8TkFokBRGBiNGM1",
  },
  {
    id: "hydropump",
    name: "Hydropump by Hydrex",
    handle: "@HydrexFi",
    logoUrl: "/logos/partners/hydropump.webp",
    tracks: ["Meme & Community Economies"],
    role: "Prediction Pools, Streaks, Leaderboards & Concentrated Stock Liquidity",
    notionUrl: "https://yielding-decision-cc4.notion.site/Hydrex-Stocks-Maxxing-40e3c9b469178000a6dbc74ac8610322",
    telegramUrl: "https://t.me/+Cv4O0OdM32o2NzFl",
  },
];

/**
 * Canonical Registry of Coinbase-Issued B20 Tokenized Stocks on Base Mainnet (Chain ID 8453)
 * With Official Coinbase Equity Icons downloaded from `metadata.coinbase.com/equity_icons/`
 */
export const BASE_TOKENIZED_STOCKS: TokenizedStockMetadata[] = [
  {
    symbol: "NVDAc",
    tickerUnderlying: "NVDA",
    name: "Coinbase NVIDIA",
    companyName: "NVIDIA Corporation",
    b20Address: "0xb20000000000000000000078ee7ce2fE4908108C",
    chainlinkFeed: "0x04689a41629776563E6822F76f2e57D148d28513",
    decimals: 8,
    isin: "US67066G1040",
    sector: "AI & Semiconductors",
    color: "#76B900",
    logoUrl: "/logos/stocks/NVDAc.png",
    officialCoinbaseIconUrl:
      "https://metadata.coinbase.com/equity_icons/1fee9b7a44e800d438dd9d96c3283e05784c925c2c871a48ff735950740b551a.png",
    prospectusUrl: "https://api.coinbase.com/v1/tokenized-stocks/prospectus/NVDAc.pdf",
    basescanUrl: "https://basescan.org/token/0xb20000000000000000000078ee7ce2fE4908108C",
    description:
      "Accelerated computing and AI GPU leader. One of the most liquid tokenized stocks on Base.",
    defaultMultiplier: 1.00053794,
    beta: 1.68,
    aiScoreBase: 96,
  },
  {
    symbol: "AAPLc",
    tickerUnderlying: "AAPL",
    name: "Coinbase Apple",
    companyName: "Apple Inc.",
    b20Address: "0xb200000000000000000000C2e324d24d7eEcd1fb",
    chainlinkFeed: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
    decimals: 8,
    isin: "US0378331005",
    sector: "Consumer & Hardware",
    color: "#A2AAAD",
    logoUrl: "/logos/stocks/AAPLc.png",
    officialCoinbaseIconUrl:
      "https://metadata.coinbase.com/equity_icons/873819f4b14efe44b94abecbc8e8864d2998163abd0ca55b449ee6eb07d0d94c.png",
    prospectusUrl: "https://api.coinbase.com/v1/tokenized-stocks/prospectus/AAPLc.pdf",
    basescanUrl: "https://basescan.org/token/0xb200000000000000000000C2e324d24d7eEcd1fb",
    description:
      "Global consumer hardware & edge-AI ecosystem flagship with strong cashflow & dividend compounding.",
    defaultMultiplier: 1.0,
    beta: 1.18,
    aiScoreBase: 91,
  },
  {
    symbol: "TSLAc",
    tickerUnderlying: "TSLA",
    name: "Coinbase Tesla",
    companyName: "Tesla Inc.",
    b20Address: "0xb2000000000000000000001e800a7f5189430cD0",
    chainlinkFeed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
    decimals: 8,
    isin: "US88160R1014",
    sector: "Frontier & Crypto",
    color: "#E82127",
    logoUrl: "/logos/stocks/TSLAc.png",
    officialCoinbaseIconUrl:
      "https://metadata.coinbase.com/equity_icons/a3b67028295d0e9fa3182c867b8a9afed5ebcbd8c012de3a46e160ae5e490980.png",
    prospectusUrl: "https://api.coinbase.com/v1/tokenized-stocks/prospectus/TSLAc.pdf",
    basescanUrl: "https://basescan.org/token/0xb2000000000000000000001e800a7f5189430cD0",
    description:
      "Autonomous robotics, Cybercab fleet, energy storage, and EV leader with high onchain velocity.",
    defaultMultiplier: 1.0,
    beta: 2.05,
    aiScoreBase: 89,
  },
  {
    symbol: "MSFTc",
    tickerUnderlying: "MSFT",
    name: "Coinbase Microsoft",
    companyName: "Microsoft Corporation",
    b20Address: "0xB200000000000000000000Ab99cFa739E253872B",
    chainlinkFeed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
    decimals: 8,
    isin: "US5949181045",
    sector: "Big Tech Cloud",
    color: "#00A4EF",
    logoUrl: "/logos/stocks/MSFTc.png",
    officialCoinbaseIconUrl:
      "https://metadata.coinbase.com/equity_icons/e90930ade985016f48816c6bd9fd1e8274b28507f4833881b3a16c77c2a3e2e7.png",
    prospectusUrl: "https://api.coinbase.com/v1/tokenized-stocks/prospectus/MSFTc.pdf",
    basescanUrl: "https://basescan.org/token/0xB200000000000000000000Ab99cFa739E253872B",
    description:
      "Enterprise cloud (Azure) and AI Copilot powerhouse with defensive institutional balance sheet.",
    defaultMultiplier: 1.0,
    beta: 1.05,
    aiScoreBase: 94,
  },
  {
    symbol: "METAc",
    tickerUnderlying: "META",
    name: "Coinbase Meta",
    companyName: "Meta Platforms Inc.",
    b20Address: "0xb2000000000000000000008bC8786B856E61707C",
    chainlinkFeed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
    decimals: 8,
    isin: "US30303M1027",
    sector: "Big Tech Cloud",
    color: "#0668E1",
    logoUrl: "/logos/stocks/METAc.png",
    officialCoinbaseIconUrl:
      "https://metadata.coinbase.com/equity_icons/1cedbfb3caee9498470945ff5041715b8c90921d904b3567a43bc4df82069e66.png",
    prospectusUrl: "https://api.coinbase.com/v1/tokenized-stocks/prospectus/METAc.pdf",
    basescanUrl: "https://basescan.org/token/0xb2000000000000000000008bC8786B856E61707C",
    description:
      "Open-weights Llama AI leader, social graph monetizer, and AR hardware innovator.",
    defaultMultiplier: 1.00031379,
    beta: 1.38,
    aiScoreBase: 92,
  },
  {
    symbol: "GOOGLc",
    tickerUnderlying: "GOOGL",
    name: "Coinbase Alphabet",
    companyName: "Alphabet Inc.",
    b20Address: "0xb2000000000000000000002D0BA3164cc74f58B7",
    chainlinkFeed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
    decimals: 8,
    isin: "US02079K3059",
    sector: "Big Tech Cloud",
    color: "#4285F4",
    logoUrl: "/logos/stocks/GOOGLc.png",
    officialCoinbaseIconUrl:
      "https://metadata.coinbase.com/equity_icons/0e80e31df40f7c42b49a3c7f6d23c6351625d73f235aeb69006ddee9221702b0.png",
    prospectusUrl: "https://api.coinbase.com/v1/tokenized-stocks/prospectus/GOOGLc.pdf",
    basescanUrl: "https://basescan.org/token/0xb2000000000000000000002D0BA3164cc74f58B7",
    description:
      "Custom TPU silicon, Gemini AI models, Google Cloud, and Waymo autonomous mobility.",
    defaultMultiplier: 1.00037712,
    beta: 1.15,
    aiScoreBase: 93,
  },
  {
    symbol: "AMZNc",
    tickerUnderlying: "AMZN",
    name: "Coinbase Amazon",
    companyName: "Amazon.com Inc.",
    b20Address: "0xb200000000000000000000d9192b6B456483C2E8",
    chainlinkFeed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
    decimals: 8,
    isin: "US0231351067",
    sector: "Big Tech Cloud",
    color: "#FF9900",
    logoUrl: "/logos/stocks/AMZNc.png",
    officialCoinbaseIconUrl:
      "https://metadata.coinbase.com/equity_icons/06d3c2cac2c89e3a8bc4b2fe40ff259f104b55244321dea400e44b22f215896b.png",
    prospectusUrl: "https://api.coinbase.com/v1/tokenized-stocks/prospectus/AMZNc.pdf",
    basescanUrl: "https://basescan.org/token/0xb200000000000000000000d9192b6B456483C2E8",
    description:
      "AWS cloud infrastructure backbone, Trainium custom AI chips, and global robotic logistics.",
    defaultMultiplier: 1.0,
    beta: 1.22,
    aiScoreBase: 90,
  },
  {
    symbol: "MSTRc",
    tickerUnderlying: "MSTR",
    name: "Coinbase Strategy",
    companyName: "Strategy Inc.",
    b20Address: "0xb2000000000000000000004884b426556b92883d",
    chainlinkFeed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a",
    decimals: 8,
    isin: "US5949724083",
    sector: "Frontier & Crypto",
    color: "#F7931A",
    logoUrl: "/logos/stocks/MSTRc.png",
    officialCoinbaseIconUrl:
      "https://metadata.coinbase.com/equity_icons/496024423dd795f8b547ffa0668f12a1e6bf09af247534754546a1a6661c7969.png",
    prospectusUrl: "https://api.coinbase.com/v1/tokenized-stocks/prospectus/MSTRc.pdf",
    basescanUrl: "https://basescan.org/token/0xb2000000000000000000004884b426556b92883d",
    description:
      "Largest corporate Bitcoin treasury company, bridging institutional equity capital markets with digital assets.",
    defaultMultiplier: 1.0,
    beta: 2.65,
    aiScoreBase: 87,
  },
  {
    symbol: "SNDKc",
    tickerUnderlying: "SNDK",
    name: "Coinbase Sandisk",
    companyName: "Sandisk Corporation",
    b20Address: "0xb200000000000000000000397293Cb8cda9a10c5",
    chainlinkFeed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA",
    decimals: 8,
    isin: "US80004C2008",
    sector: "AI & Semiconductors",
    color: "#E11D48",
    logoUrl: "/logos/stocks/SNDKc.png",
    officialCoinbaseIconUrl:
      "https://metadata.coinbase.com/equity_icons/495de6bc9902690826d533b9506494890f59d611d10f04231c00936f659bb0cb.png",
    prospectusUrl: "https://api.coinbase.com/v1/tokenized-stocks/prospectus/SNDKc.pdf",
    basescanUrl: "https://basescan.org/token/0xb200000000000000000000397293Cb8cda9a10c5",
    description:
      "Enterprise NAND flash storage & high-density data center memory critical for AI training clusters.",
    defaultMultiplier: 1.0,
    beta: 1.54,
    aiScoreBase: 88,
  },
  {
    symbol: "SPCXc",
    tickerUnderlying: "SPCX",
    name: "Coinbase SpaceX",
    companyName: "Space Exploration Technologies Corp.",
    b20Address: "0xb2000000000000000000007b9fcbd005511aCBd5",
    chainlinkFeed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68",
    decimals: 8,
    isin: "US84621P1003",
    sector: "Frontier & Crypto",
    color: "#6366F1",
    logoUrl: "/logos/stocks/SPCXc.png",
    officialCoinbaseIconUrl:
      "https://metadata.coinbase.com/equity_icons/79fa65beabbe27c7b84a38b8f67a492793a0c203a5312c8feddc23e4b7c66b79.png",
    prospectusUrl: "https://api.coinbase.com/v1/tokenized-stocks/prospectus/SPCXc.pdf",
    basescanUrl: "https://basescan.org/token/0xb2000000000000000000007b9fcbd005511aCBd5",
    description:
      "Orbital launch monopoly (Starship/Falcon) & Starlink global satellite broadband constellation.",
    defaultMultiplier: 1.0,
    beta: 1.75,
    aiScoreBase: 95,
  },
];

/** Smallest buy per stock, in USD. One number for the swap API, every amount field and the rebalancer. */
export const MIN_BUY_USD = 0.5;

export const PROGRAMMABLE_INDEX_PRESETS: ProgrammableIndexPreset[] = [
  {
    id: "maxx-ai-compute",
    name: "AI and Compute Index",
    ticker: "MAXX-AI",
    tagline: "AI infrastructure basket: GPU silicon, hyperscale cloud, and AI memory.",
    riskLevel: "Balanced",
    rebalanceCadence: "Creator-updated weights",
    strategyThesis:
      "Overweights B20 tokenized equities capturing AI capex infrastructure (NVDAc, SNDKc) paired with hyperscaler monetization (MSFTc, GOOGLc, METAc). Share-equivalent balances reflect dividends & splits via the B20 uiMultiplier.",
    allocations: [
      { symbol: "NVDAc", weightBps: 3200, rationale: "Core AI training & inference GPU dominance" },
      { symbol: "MSFTc", weightBps: 2000, rationale: "Azure AI cloud & enterprise Copilot revenue" },
      { symbol: "GOOGLc", weightBps: 1800, rationale: "Custom TPU v6 infrastructure & Gemini distribution" },
      { symbol: "SNDKc", weightBps: 1600, rationale: "High-density enterprise NAND flash storage cycle" },
      { symbol: "METAc", weightBps: 1400, rationale: "Open-source Llama AI ad-targeting yield" },
    ],
  },
  {
    id: "maxx-frontier",
    name: "Frontier Tech Index",
    ticker: "MAXX-FRNT",
    tagline: "High-beta tokenized exposure to orbital aerospace, autonomous robotics, and Bitcoin treasury.",
    riskLevel: "High-Octane",
    rebalanceCadence: "Creator-updated weights",
    strategyThesis:
      "Captures non-correlated frontier innovation on Base: SpaceX orbital & Starlink dominance (SPCXc), Tesla autonomous fleet (TSLAc), Strategy Bitcoin leverage (MSTRc), and NVIDIA compute (NVDAc).",
    allocations: [
      { symbol: "SPCXc", weightBps: 3000, rationale: "Unmatched orbital launch & Starlink cashflow growth" },
      { symbol: "TSLAc", weightBps: 2800, rationale: "Full Self-Driving & Optimus humanoid robotics optionality" },
      { symbol: "MSTRc", weightBps: 2200, rationale: "Onchain-native Bitcoin treasury reflexivity" },
      { symbol: "NVDAc", weightBps: 2000, rationale: "Physical AI & robotics simulation backbone" },
    ],
  },
  {
    id: "maxx-mega-cap",
    name: "Mega-Cap Tech Index",
    ticker: "MAXX-MEGA",
    tagline: "Mega-cap tech basket tracked with Chainlink total-return feeds.",
    riskLevel: "Conservative",
    rebalanceCadence: "Creator-updated weights",
    strategyThesis:
      "Tracks the largest mega-cap technology balance sheets on Base using Chainlink Total-Return feeds. Cash dividends are reflected as an increase in the B20 `uiMultiplier`, raising share-equivalent balances (`balanceOfUI`).",
    allocations: [
      { symbol: "AAPLc", weightBps: 2000, rationale: "Consumer ecosystem fortress & buyback yield" },
      { symbol: "MSFTc", weightBps: 2000, rationale: "Enterprise software & cloud recurring cashflow" },
      { symbol: "NVDAc", weightBps: 1800, rationale: "Datacenter compute growth engine" },
      { symbol: "GOOGLc", weightBps: 1500, rationale: "Search & YouTube cash cow at attractive multiple" },
      { symbol: "AMZNc", weightBps: 1500, rationale: "AWS operating margin expansion" },
      { symbol: "METAc", weightBps: 1200, rationale: "Social ad efficiency & capital return" },
    ],
  },
];

export const B20_AND_CHAINLINK_ABI = [
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "uiMultiplier",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "multiplier",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOfUI",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "rawAmount", type: "uint256" }],
    name: "toUIAmount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "uiAmount", type: "uint256" }],
    name: "fromUIAmount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "policyId",
    outputs: [{ internalType: "uint64", name: "", type: "uint64" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "id", type: "uint256" },
      { internalType: "address", name: "account", type: "address" },
    ],
    name: "isAuthorized",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "paused",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "latestRoundData",
    outputs: [
      { internalType: "uint80", name: "roundId", type: "uint80" },
      { internalType: "int256", name: "answer", type: "int256" },
      { internalType: "uint256", name: "startedAt", type: "uint256" },
      { internalType: "uint256", name: "updatedAt", type: "uint256" },
      { internalType: "uint80", name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;
