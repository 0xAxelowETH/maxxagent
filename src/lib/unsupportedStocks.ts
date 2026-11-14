/**
 * Coinbase tokenized stocks that exist on Base but that MAXXAGENT does not support. The agent names them
 * when a request asks for one, so it never claims the stock doesn't exist.
 *
 * Addresses from https://api.coinbase.com/v1/tokenized-stocks (358 stocks, checked 2026-11-14).
 * `chainlink`: Chainlink publishes a "Coinbase <TICKER>" price feed for it on Base (data.chain.link).
 * MAXXAGENT supports 10 stocks with deep Base liquidity and a Chainlink price; these are left out.
 */
export const UNSUPPORTED_COINBASE_STOCKS: Record<string, { address: `0x${string}`; chainlink: boolean }> = {
  AMDc: { address: "0xB2000000000000000000000d8Ce462E99ee7A47B", chainlink: false },
  INTCc: { address: "0xB2000000000000000000004AFF16039bA04bdFBc", chainlink: true },
  AVGOc: { address: "0xB200000000000000000000Fc737aeA6196aB5a4c", chainlink: false },
  QCOMc: { address: "0xB2000000000000000000005672D78eFF30D24665", chainlink: false },
  MUc: { address: "0xb200000000000000000000Fd2f87532B90095211", chainlink: false },
  PLTRc: { address: "0xb2000000000000000000007d16372840dF4dAbbe", chainlink: false },
  CRMc: { address: "0xB2000000000000000000006432a3a7991e718DBB", chainlink: false },
  ADBEc: { address: "0xB20000000000000000000034533Ed3961f222Cd4", chainlink: false },
  ORCLc: { address: "0xb200000000000000000000347AFbA223D7B6b63C", chainlink: false },
  NFLXc: { address: "0xb20000000000000000000058B8c947e44011dFE6", chainlink: false },
  WMTc: { address: "0xb2000000000000000000008a7508619c717A7106", chainlink: false },
  DISc: { address: "0xb2000000000000000000000bD75bF439A38bF7DF", chainlink: false },
  UBERc: { address: "0xb200000000000000000000cAE20cb1446462e24c", chainlink: false },
  "BRK.Bc": { address: "0xb20000000000000000000024170488e788CBbCb4", chainlink: false },
  JPMc: { address: "0xB200000000000000000000FDe956536A25725156", chainlink: false },
  Vc: { address: "0xB20000000000000000000054b11Fd279a4f7D4EF", chainlink: false },
  LLYc: { address: "0xB200000000000000000000f1a0F91e34892E4718", chainlink: false },
  PFEc: { address: "0xB20000000000000000000018FE7eC7d6DfeeB528", chainlink: false },
  XOMc: { address: "0xb20000000000000000000065F7d0D6aac5fD4Bfd", chainlink: false },
  BAc: { address: "0xB200000000000000000000Fd10D35a781efB5C2F", chainlink: false },
  HOODc: { address: "0xb2000000000000000000006F944897540579D3f2", chainlink: false },
  CRCLc: { address: "0xB20000000000000000000019f6E7C675b73C2e4D", chainlink: true },
  TTWOc: { address: "0xB200000000000000000000f720C26062Bc3067Da", chainlink: false },
};

export interface UnsupportedLive {
  /** total USD liquidity of its pools on Base (DexScreener), null when it couldn't be read */
  liquidityUsd: number | null;
  /** largest pool, to check the number */
  poolUrl?: string;
}

const cache = new Map<string, { at: number; value: UnsupportedLive }>();

/** Live Base liquidity for unsupported stocks the request named. Server only; waits at most 3 s. */
export async function getUnsupportedLive(tokens: string[]): Promise<Record<string, UnsupportedLive>> {
  const out: Record<string, UnsupportedLive> = {};
  const todo: string[] = [];
  for (const t of tokens) {
    const c = cache.get(t);
    if (c && Date.now() - c.at < 5 * 60_000) out[t] = c.value;
    else if (UNSUPPORTED_COINBASE_STOCKS[t]) todo.push(t);
  }
  if (!todo.length) return out;
  try {
    const addrs = todo.map((t) => UNSUPPORTED_COINBASE_STOCKS[t].address);
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/base/${addrs.join(",")}`, { signal: AbortSignal.timeout(3000) });
    const pairs = res.ok ? ((await res.json()) as { baseToken?: { address?: string }; quoteToken?: { address?: string }; liquidity?: { usd?: number }; url?: string }[]) : null;
    if (!Array.isArray(pairs)) return out;
    for (const t of todo) {
      const a = UNSUPPORTED_COINBASE_STOCKS[t].address.toLowerCase();
      const ps = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === a || p.quoteToken?.address?.toLowerCase() === a);
      const top = [...ps].sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0))[0];
      const value = { liquidityUsd: ps.reduce((s, p) => s + (p.liquidity?.usd || 0), 0), poolUrl: top?.url };
      cache.set(t, { at: Date.now(), value });
      out[t] = value;
    }
  } catch {
    // Without live numbers the agent still explains why the stock isn't supported
  }
  return out;
}
