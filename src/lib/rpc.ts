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
  // Each fallback URL used to get the full timeout, so one failing call could take 3x as long and blow the
  // route budgets built on it. The first provider (the one that normally answers) keeps the full timeout;
  // fallbacks get 20% each (3 s floor), so the worst case is about 1.4x instead of 3x.
  const share = (i: number) => (i === 0 ? timeout : Math.max(3_000, Math.round(timeout * 0.2)));
  // Zero transport-level retries per URL so fallback switches providers immediately instead of stacking latency
  return fallback(
    urls.map((u, i) => http(u, { timeout: share(i), retryCount: 0 })),
    { rank: false, retryCount: 0 }
  );
}

/** Removes RPC URLs / API keys from error messages before they leave the server. */
export function redactSecrets(message: string): string {
  let out = message;
  const custom = customRpc();
  if (custom) out = out.split(custom).join("<private-rpc>");
  return out
    .replace(/https?:\/\/[^\s"']*(?:rpc|alchemy|infura|quiknode|quicknode|ankr|drpc|chainstack|blastapi|llamarpc|developer\.coinbase)[^\s"']*/gi, "<private-rpc>")
    .replace(/(?:api_key|apikey|key|token)=[^&\s"']+/gi, (m) => `${m.split("=")[0]}=<redacted>`);
}
