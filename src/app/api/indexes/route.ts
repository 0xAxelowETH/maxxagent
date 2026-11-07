import { NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { baseTransport, redactSecrets } from "@/lib/rpc";
import { base } from "viem/chains";
import { INDEX_REGISTRY_ABI } from "@/lib/contracts/StockMaxxIndexRegistryABI";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";

/** Lists the most recent indexes published to StockMaxxIndexRegistry on Base Mainnet. */
const REGISTRY = process.env.NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS || "";
const MAX_RESULTS = 20;
// Anyone can publish: index ids listed here (comma separated) are hidden from the site (spam, offensive names)
const HIDDEN = new Set(
  (process.env.INDEX_HIDE || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x))
    .map(Number)
);
const KNOWN = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.b20Address.toLowerCase(), s.symbol]));
// Strip control / bidi-override characters so a name can't break or spoof the layout
const cleanText = (v: string) => v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
const CACHE = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" };

const client = createPublicClient({
  chain: base,
  transport: baseTransport({ timeout: 10000 }),
  batch: { multicall: true },
});

export const dynamic = "force-dynamic";

export async function GET() {
  if (!/^0x[a-fA-F0-9]{40}$/.test(REGISTRY)) {
    return NextResponse.json({ ok: true, deployed: false, registry: null, total: 0, indexes: [] }, { headers: CACHE });
  }
  try {
    const registry = REGISTRY as `0x${string}`;
    const total = Number(
      await client.readContract({ address: registry, abi: INDEX_REGISTRY_ABI, functionName: "indexCount" })
    );
    // newest first, skipping hidden ids (scan a little further so hidden ones don't shrink the list)
    const ids: bigint[] = [];
    for (let id = total - 1; id >= 0 && ids.length < MAX_RESULTS && total - id <= MAX_RESULTS * 3; id--) {
      if (!HIDDEN.has(id)) ids.push(BigInt(id));
    }
    const results = await client.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({
        address: registry,
        abi: INDEX_REGISTRY_ABI,
        functionName: "getIndex" as const,
        args: [id],
      })),
    });
    const indexes = results.flatMap((r, i) => {
      if (r.status !== "success") return [];
      const [name, ticker, creator, createdAt, updatedAt, version, tokens, weightsBps] = r.result as readonly [
        string,
        string,
        string,
        bigint,
        bigint,
        number,
        readonly string[],
        readonly number[],
      ];
      // Only indexes made of stocks this app can trade (the allowlist could be extended later)
      if (!tokens.every((t) => KNOWN.has(t.toLowerCase()))) return [];
      const safeName = cleanText(name);
      const safeTicker = cleanText(ticker);
      if (!safeName || !safeTicker) return [];
      return [
        {
          id: Number(ids[i]),
          name: safeName,
          ticker: safeTicker,
          creator,
          createdAt: Number(createdAt),
          updatedAt: Number(updatedAt),
          version: Number(version),
          constituents: tokens.map((t, j) => ({ symbol: KNOWN.get(t.toLowerCase())!, b20Address: t, weightBps: Number(weightsBps[j]) })),
        },
      ];
    });
    return NextResponse.json({ ok: true, deployed: true, registry, total, indexes }, { headers: CACHE });
  } catch (e) {
    return NextResponse.json(
      { ok: false, deployed: true, registry: REGISTRY, error: redactSecrets(e instanceof Error ? ((e as { shortMessage?: string }).shortMessage || e.message) : "Read failed") },
      { status: 502 }
    );
  }
}
