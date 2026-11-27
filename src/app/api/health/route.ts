import { NextResponse } from "next/server";
import { createPublicClient, parseAbi } from "viem";
import { baseTransport, redactSecrets } from "@/lib/rpc";
import { base } from "viem/chains";
import { checkB20Transfers } from "@/lib/b20Guard";

/**
 * Health check for every data source MAXXAGENT depends on.
 * Point an uptime monitor (e.g. UptimeRobot) at /api/health; it returns 503 when a critical source is down.
 * `b20Transfers` also fails when an issuer control (transfer pause, sender/receiver/executor policy) would
 * stop swaps of one of the 10 stocks; a GitHub Actions workflow checks this endpoint every 6 hours.
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
let inflight: Promise<{ body: unknown; status: number }> | null = null;

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; detail?: string; value?: T }> {
  const t = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - t, value };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, detail: redactSecrets(e instanceof Error ? ((e as { shortMessage?: string }).shortMessage || e.message) : "failed").slice(0, 300) };
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
  if (cached && cached.status === 200 && Date.now() - cached.at < 60_000) {
    return NextResponse.json(cached.body, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
  if (!inflight) {
    inflight = (async () => {
      const [rpc, chainlink, dexscreener, kyber, gecko, b20] = await Promise.all([
        timed(() => client.getBlockNumber()),
        timed(async () => {
          const r = await client.readContract({
            address: NVDA_FEED,
            abi: parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]),
            functionName: "latestRoundData",
          });
          if (r[1] <= 0n || r[4] < r[0]) throw new Error("Invalid Chainlink round");
          const ageMinutes = Math.round((Date.now() / 1000 - Number(r[3])) / 60);
          // Tokenized US stock feeds are 24/5 (paused across 48h weekends and 72h holiday weekends)
          if (ageMinutes < -5 || ageMinutes > 4 * 24 * 60) throw new Error(`Stale Chainlink oracle (${ageMinutes}m)`);
          return ageMinutes;
        }),
        timed(() => fetchOk(`https://api.dexscreener.com/tokens/v1/base/${NVDA}`)),
        timed(() =>
          fetchOk(`https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${USDC}&tokenOut=${NVDA}&amountIn=1000000`, {
            headers: { "x-client-id": "maxxagent" },
          })
        ),
        timed(() => fetchOk(`https://api.geckoterminal.com/api/v2/networks/base/tokens/${NVDA}`)),
        // Doesn't throw on a rule problem, so the per-stock rows reach the status page; ok is set below
        timed(() => checkB20Transfers(client)),
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
        // Issuer controls on the 10 B20 stocks still let swaps through (see src/lib/b20Guard.ts)
        b20Transfers: {
          ok: b20.ok && b20.value?.ok === true,
          ms: b20.ms,
          detail: b20.detail ?? (b20.value && !b20.value.ok ? b20.value.problems.slice(0, 3).join("; ").slice(0, 300) : undefined),
          policies: b20.value?.policies.NVDAc,
          // One row per stock (policies, pause, who may transfer it), shown on /status
          stocks: b20.value?.stocks,
          critical: true,
        },
      };
      const healthy = Object.values(checks).every((c) => c.ok || !c.critical);
      const body = { ok: healthy, checkedAt: new Date().toISOString(), checks };
      const status = healthy ? 200 : 503;
      if (healthy) cached = { at: Date.now(), body, status };
      return { body, status };
    })().finally(() => {
      inflight = null;
    });
  }
  const { body, status } = await inflight;
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
