import { fallback, http } from "viem";

/**
 * Server-side Base Mainnet transport with automatic failover:
 *   1. BASE_RPC_URL (dedicated, e.g. Coinbase CDP / Alchemy) — if set
 *   2. public https://mainnet.base.org
 *   3. public https://base-rpc.publicnode.com
 * Never import this in client components: BASE_RPC_URL contains a private key.
 */
const PUBLIC_RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];

function customRpc(): string {
  return (process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL || "").trim();
}

export function baseTransport(opts: { timeout?: number } = {}) {
  const timeout = opts.timeout ?? 10_000;
  const custom = customRpc();
  const urls = [...(custom && !PUBLIC_RPCS.includes(custom) ? [custom] : []), ...PUBLIC_RPCS];
  return fallback(
    urls.map((u) => http(u, { timeout, retryCount: 1 })),
    { rank: false, retryCount: 1 }
  );
}

/** Removes RPC URLs / API keys from error messages before they leave the server. */
export function redactSecrets(message: string): string {
  let out = message;
  const custom = customRpc();
  if (custom) out = out.split(custom).join("<private-rpc>");
  return out
    .replace(/https?:\/\/[^\s"']*(?:rpc|alchemy|infura|quiknode|quicknode|developer\.coinbase)[^\s"']*/gi, "<private-rpc>")
    .replace(/apikey=[^&\s"']+/gi, "apikey=<redacted>");
}
