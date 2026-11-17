import { NextResponse } from "next/server";
import { redactSecrets } from "@/lib/rpc";
import { HIDDEN, REGISTRY, indexCount, readIndexes, registryDeployed } from "@/lib/indexRegistry";

/** Lists the most recent indexes published to StockMaxxIndexRegistry on Base Mainnet. */
const MAX_RESULTS = 20;
const CACHE = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" };

export const dynamic = "force-dynamic";

export async function GET() {
  if (!registryDeployed()) {
    return NextResponse.json({ ok: true, deployed: false, registry: null, total: 0, indexes: [] }, { headers: CACHE });
  }
  try {
    const total = await indexCount();
    // Newest first, skipping hidden ids up to a generous bound so spam/hidden ids don't hide real indexes
    const ids: number[] = [];
    for (let id = total - 1; id >= 0 && ids.length < MAX_RESULTS && total - id <= MAX_RESULTS * 10; id--) {
      if (!HIDDEN.has(id)) ids.push(id);
    }
    const indexes = await readIndexes(ids);
    return NextResponse.json({ ok: true, deployed: true, registry: REGISTRY, total, indexes }, { headers: CACHE });
  } catch (e) {
    console.error("indexes route error", redactSecrets(e instanceof Error ? e.message : String(e)));
    return NextResponse.json(
      { ok: false, deployed: true, registry: REGISTRY, error: "Could not read onchain indexes. Please retry." },
      { status: 502 }
    );
  }
}
