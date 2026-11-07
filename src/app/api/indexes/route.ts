import { NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { baseTransport, redactSecrets } from "@/lib/rpc";
import { base } from "viem/chains";
import { INDEX_REGISTRY_ABI } from "@/lib/contracts/StockMaxxIndexRegistryABI";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";

/** Lists the most recent indexes published to StockMaxxIndexRegistry on Base Mainnet. */
const REGISTRY = process.env.NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS || "";
const MAX_RESULTS = 20;

const client = createPublicClient({
  chain: base,
  transport: baseTransport({ timeout: 10000 }),
  batch: { multicall: true },
});

export const dynamic = "force-dynamic";

export async function GET() {
  if (!/^0x[a-fA-F0-9]{40}$/.test(REGISTRY)) {
    return NextResponse.json({ ok: true, deployed: false, registry: null, total: 0, indexes: [] });
  }
  try {
    const registry = REGISTRY as `0x${string}`;
    const total = Number(
      await client.readContract({ address: registry, abi: INDEX_REGISTRY_ABI, functionName: "indexCount" })
    );
    const ids = Array.from({ length: Math.min(total, MAX_RESULTS) }, (_, i) => BigInt(total - 1 - i));
    const results = await client.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({
        address: registry,
        abi: INDEX_REGISTRY_ABI,
        functionName: "getIndex" as const,
        args: [id],
      })),
    });
    const symbolOf = (addr: string) =>
      BASE_TOKENIZED_STOCKS.find((s) => s.b20Address.toLowerCase() === addr.toLowerCase())?.symbol ?? addr;

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
      return [
        {
          id: Number(ids[i]),
          name,
          ticker,
          creator,
          createdAt: Number(createdAt),
          updatedAt: Number(updatedAt),
          version: Number(version),
          constituents: tokens.map((t, j) => ({ symbol: symbolOf(t), b20Address: t, weightBps: Number(weightsBps[j]) })),
        },
      ];
    });
    return NextResponse.json({ ok: true, deployed: true, registry, total, indexes });
  } catch (e) {
    return NextResponse.json(
      { ok: false, deployed: true, registry: REGISTRY, error: redactSecrets(e instanceof Error ? ((e as { shortMessage?: string }).shortMessage || e.message) : "Read failed") },
      { status: 502 }
    );
  }
}
