import { createPublicClient } from "viem";
import { base } from "viem/chains";
import { baseTransport } from "./rpc";
import { INDEX_REGISTRY_ABI } from "./contracts/StockMaxxIndexRegistryABI";
import { BASE_TOKENIZED_STOCKS } from "./tokenizedStocks";

/** Server-side reads of StockMaxxIndexRegistry (shared by /api/indexes and /index/[id]). */
export const REGISTRY = (process.env.NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS || "") as `0x${string}` | "";
export const registryDeployed = () => /^0x[a-fA-F0-9]{40}$/.test(REGISTRY);

// Anyone can publish: index ids listed here (comma separated) are hidden from the site (spam, offensive names)
export const HIDDEN = new Set(
  (process.env.INDEX_HIDE || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x))
    .map(Number)
);
const KNOWN = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.b20Address.toLowerCase(), s.symbol]));
// Strip control / bidi-override characters so a name can't break or spoof the layout
const cleanText = (v: string) => v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").trim();

const client = createPublicClient({ chain: base, transport: baseTransport({ timeout: 10000 }), batch: { multicall: true } });

export interface PublishedIndex {
  id: number;
  name: string;
  ticker: string;
  creator: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  constituents: { symbol: string; b20Address: string; weightBps: number }[];
}

type Raw = readonly [string, string, string, bigint, bigint, number, readonly string[], readonly number[]];

/** null when the index is hidden, holds a stock the app doesn't list, or has an empty name/ticker */
function toIndex(id: number, raw: Raw): PublishedIndex | null {
  const [name, ticker, creator, createdAt, updatedAt, version, tokens, weightsBps] = raw;
  if (HIDDEN.has(id)) return null;
  if (!tokens.every((t) => KNOWN.has(t.toLowerCase()))) return null;
  const safeName = cleanText(name);
  const safeTicker = cleanText(ticker);
  if (!safeName || !safeTicker) return null;
  return {
    id,
    name: safeName,
    ticker: safeTicker,
    creator,
    createdAt: Number(createdAt),
    updatedAt: Number(updatedAt),
    version: Number(version),
    constituents: tokens.map((t, j) => ({ symbol: KNOWN.get(t.toLowerCase())!, b20Address: t, weightBps: Number(weightsBps[j]) })),
  };
}

export async function indexCount(): Promise<number> {
  if (!registryDeployed()) return 0;
  return Number(await client.readContract({ address: REGISTRY as `0x${string}`, abi: INDEX_REGISTRY_ABI, functionName: "indexCount" }));
}

export async function readIndexes(ids: number[]): Promise<PublishedIndex[]> {
  if (!registryDeployed() || ids.length === 0) return [];
  const results = await client.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({ address: REGISTRY as `0x${string}`, abi: INDEX_REGISTRY_ABI, functionName: "getIndex" as const, args: [BigInt(id)] })),
  });
  return results.flatMap((r, i) => {
    if (r.status !== "success") return [];
    const ix = toIndex(ids[i], r.result as unknown as Raw);
    return ix ? [ix] : [];
  });
}

export async function readIndex(id: number): Promise<PublishedIndex | null> {
  if (!Number.isInteger(id) || id < 0 || HIDDEN.has(id)) return null;
  const total = await indexCount();
  if (id >= total) return null;
  return (await readIndexes([id]))[0] ?? null;
}
