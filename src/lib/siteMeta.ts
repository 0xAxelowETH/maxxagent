import type { TokenizedStockMetadata } from "./tokenizedStocks";

/**
 * Titles and descriptions for link previews, shared by the pages' metadata and the middleware's
 * preview tags for visitors outside the eligible regions (where X, Farcaster and Telegram crawl from),
 * so a shared link reads the same everywhere.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, "");
export const SITE_TITLE = "MAXXAGENT — Tokenized stock baskets on Base";
export const SITE_DESCRIPTION =
  "Build your own index of Coinbase tokenized stocks on Base, or let an agent propose one, and buy it in one flow from your own wallet. Live Chainlink NAV vs DEX prices, non-custodial. Not financial advice.";

export const stockTitle = (s: Pick<TokenizedStockMetadata, "symbol" | "companyName">) => `${s.symbol} (${s.companyName}) tokenized stock on Base — MAXXAGENT`;
export const stockDescription = (s: Pick<TokenizedStockMetadata, "symbol" | "companyName">) =>
  `Live Chainlink NAV, Base DEX price and liquidity for ${s.symbol}, Coinbase's tokenized ${s.companyName} stock on Base. Buy or sell from your own wallet. Not financial advice.`;

export const indexTitleFallback = (id: string | number) => `Onchain stock index #${id} — MAXXAGENT`;
export const INDEX_DESCRIPTION_FALLBACK =
  "A tokenized stock index published onchain on Base; buy the whole basket from your own wallet with USDC or ETH. Not financial advice.";

/** Share card paths (see /api/og): 1200x630 for link previews, /tall = 1200x800 for the Farcaster / Base App embed */
export const ogPaths = {
  home: { card: "/api/og/home", tall: "/api/og/home/tall" },
  stock: (symbol: string) => ({ card: `/api/og/stock/${symbol}`, tall: `/api/og/stock/${symbol}/tall` }),
  index: (id: string | number) => ({ card: `/api/og/index/${id}`, tall: `/api/og/index/${id}/tall` }),
};
