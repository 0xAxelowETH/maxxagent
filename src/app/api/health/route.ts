import { NextResponse } from "next/server";
import { createPublicClient, parseAbi } from "viem";
import { baseTransport, redactSecrets } from "@/lib/rpc";
import { base } from "viem/chains";

/**
 * Health check for every data source MAXXAGENT depends on.
 * Point an uptime monitor (e.g. UptimeRobot) at /api/health; it returns 503 when a critical source is down.
 */
export const dynamic = "force-dynamic";

const client = createPublicClient({
  chain: base,
  transport: baseTransport({ timeout: 6000 }),
});
const NVDA_FEED = "0x04689a41629776563E6822F76f2e57D148d28513";
const NVDA = "0xb20000000000000000000078ee7ce2fE4908108C";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

let cached: { at: number; body: unknown; status: number } | null = null;

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; detail?: string; value?: T }> {
  const t = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - t, value };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, detail: redactSecrets(e instanceof Error ? ((e as { shortMessage?: string }).shortMessage || e.message) : "failed").slice(0, 120) };
  }
}

async function fetchOk(url: string, init?: RequestInit) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.status;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  if (cached && Date.now() - cached.at < 60_000) return NextResponse.json(cached.body, { status: cached.status });

  const [rpc, chainlink, dexscreener, kyber, gecko] = await Promise.all([
    timed(() => client.getBlockNumber()),
    timed(async () => {
      const r = await client.readContract({
        address: NVDA_FEED,
        abi: parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]),
        functionName: "latestRoundData",
      });
      return Math.round((Date.now() / 1000 - Number(r[3])) / 60);
    }),
    timed(() => fetchOk(`https://api.dexscreener.com/tokens/v1/base/${NVDA}`)),
    timed(() =>
      fetchOk(`https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${USDC}&tokenOut=${NVDA}&amountIn=1000000`, {
        headers: { "x-client-id": "maxxagent" },
      })
    ),
    timed(() => fetchOk(`https://api.geckoterminal.com/api/v2/networks/base/tokens/${NVDA}`)),
  ]);

  const checks = {
    baseRpc: { ok: rpc.ok, ms: rpc.ms, block: rpc.value?.toString(), detail: rpc.detail, critical: true },
    chainlink: {
      ok: chainlink.ok,
      ms: chainlink.ms,
      oracleAgeMinutes: chainlink.value,
      detail: chainlink.detail,
      critical: true,
    },
    dexscreener: { ok: dexscreener.ok, ms: dexscreener.ms, detail: dexscreener.detail, critical: false },
    kyberswap: { ok: kyber.ok, ms: kyber.ms, detail: kyber.detail, critical: true },
    geckoterminal: { ok: gecko.ok, ms: gecko.ms, detail: gecko.detail, critical: false },
  };
  const healthy = Object.values(checks).every((c) => c.ok || !c.critical);
  const body = { ok: healthy, checkedAt: new Date().toISOString(), checks };
  const status = healthy ? 200 : 503;
  cached = { at: Date.now(), body, status };
  return NextResponse.json(body, { status });
}
