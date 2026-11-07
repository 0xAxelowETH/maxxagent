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
    // newest first, skipping hidden ids (scan a little further so hidden ones don't shrink the list)
    const ids: number[] = [];
    for (let id = total - 1; id >= 0 && ids.length < MAX_RESULTS && total - id <= MAX_RESULTS * 3; id--) {
      if (!HIDDEN.has(id)) ids.push(id);
    }
    const indexes = await readIndexes(ids);
    return NextResponse.json({ ok: true, deployed: true, registry: REGISTRY, total, indexes }, { headers: CACHE });
  } catch (e) {
    return NextResponse.json(
      { ok: false, deployed: true, registry: REGISTRY, error: redactSecrets(e instanceof Error ? ((e as { shortMessage?: string }).shortMessage || e.message) : "Read failed") },
      { status: 502 }
    );
  }
}
