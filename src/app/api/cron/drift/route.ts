import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, parseAbi } from "viem";
import { base } from "viem/chains";
import { baseTransport } from "@/lib/rpc";
import { kvEnabled } from "@/lib/kv";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { computeDrift } from "@/lib/drift";
import { deleteNotify, getNotify, getWatch, listWatchFids, putWatch, type DriftWatch } from "@/lib/driftWatch";

/**
 * Daily drift check (Vercel Cron, see vercel.json: 23:00 UTC Mon–Fri = 18:00/19:00 New York, after the close
 * and the NAV update, in winter and summer time). For each watched wallet: read its stock balances and the
 * Chainlink NAV on Base, compare with the saved target, and send one mini app notification when the basket
 * goes off target (again at most every REMIND_DAYS while it stays off). Never trades.
 * The response holds counts only, no wallets.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, "");
const REMIND_DAYS = 3;
const BUDGET_MS = 50_000;

const ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);
const client = createPublicClient({ chain: base, transport: baseTransport({ timeout: 10000 }), batch: { multicall: true } });

async function navPrices(): Promise<Record<string, number>> {
  const res = await client.multicall({
    allowFailure: true,
    contracts: BASE_TOKENIZED_STOCKS.map((s) => ({ address: s.chainlinkFeed, abi: ABI, functionName: "latestRoundData" as const })),
  });
  const out: Record<string, number> = {};
  BASE_TOKENIZED_STOCKS.forEach((s, i) => {
    const r = res[i];
    if (r.status === "success") {
      const answer = (r.result as readonly [bigint, bigint, bigint, bigint, bigint])[1];
      if (answer > 0n) out[s.symbol] = Number(answer) / 1e8;
    }
  });
  return out;
}

async function holdings(address: `0x${string}`, nav: Record<string, number>) {
  const res = await client.multicall({
    allowFailure: true,
    contracts: BASE_TOKENIZED_STOCKS.map((s) => ({ address: s.b20Address, abi: ABI, functionName: "balanceOf" as const, args: [address] as const })),
  });
  // Any unreadable balance or price: skip this wallet today rather than alert on wrong numbers
  if (res.some((r) => r.status !== "success")) return null;
  return BASE_TOKENIZED_STOCKS.map((s, i) => {
    const tokens = Number(res[i].result as bigint) / 10 ** s.decimals;
    return { symbol: s.symbol, usd: tokens > 0 && nav[s.symbol] ? tokens * nav[s.symbol] : 0, missingPrice: tokens > 0 && !nav[s.symbol] };
  });
}

function message(w: DriftWatch, drift: NonNullable<ReturnType<typeof computeDrift>>) {
  const b = drift.breaches[0];
  if (b && w.target.maxWeightPct)
    return {
      title: "A stock broke your limit",
      body: `${b.symbol} is ${b.currentPct.toFixed(0)}% of your stocks, above your ${w.target.maxWeightPct}% limit. Tap to review the rebalance plan.`,
    };
  const top = drift.over[0];
  return {
    title: "Your basket drifted",
    body: `${drift.driftPct.toFixed(0)}% of your stocks are off your ${w.target.label} target${
      top ? ` (${top.symbol} +${top.diffPct.toFixed(0)} pts)` : ""
    }. Tap to review the rebalance plan.`,
  };
}

export async function GET(req: NextRequest) {
  // Vercel Cron sends "Authorization: Bearer $CRON_SECRET" when that variable is set
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  if (!kvEnabled()) return NextResponse.json({ ok: true, skipped: "storage not configured" });

  const started = Date.now();
  const counts = { watches: 0, checked: 0, off: 0, alerted: 0, skipped: 0, failed: 0 };
  try {
    const fids = await listWatchFids();
    counts.watches = fids.length;
    if (!fids.length) return NextResponse.json({ ok: true, ...counts });
    const nav = await navPrices();
    const today = new Date().toISOString().slice(0, 10);

    for (const fid of fids) {
      if (Date.now() - started > BUDGET_MS) break;
      try {
        const [w, notify] = await Promise.all([getWatch(fid), getNotify(fid)]);
        if (!w) continue;
        const held = await holdings(w.address, nav);
        if (!held || held.some((h) => h.missingPrice)) {
          counts.skipped++;
          continue;
        }
        counts.checked++;
        const drift = computeDrift(held, w.target.weights, w.target.maxWeightPct);
        const isOff = drift !== null && (drift.driftPct >= w.alertPct || drift.breaches.length > 0);
        const next: DriftWatch = { ...w, lastState: isOff ? "off" : "ok", lastCheckAt: new Date().toISOString() };
        if (isOff && drift) {
          counts.off++;
          const since = w.lastAlertAt ? Date.now() - Date.parse(w.lastAlertAt) : Infinity;
          const due = w.lastState !== "off" || since > REMIND_DAYS * 86_400_000;
          if (due && notify) {
            const { title, body } = message(w, drift);
            const res = await fetch(notify.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                notificationId: `drift-${fid}-${today}`,
                title: title.slice(0, 32),
                body: body.slice(0, 128),
                targetUrl: `${SITE}/?tab=portfolio`,
                tokens: [notify.token],
              }),
              signal: AbortSignal.timeout(8000),
            });
            const data = (await res.json().catch(() => ({}))) as { result?: { successfulTokens?: string[]; invalidTokens?: string[] } };
            if (data.result?.invalidTokens?.includes(notify.token)) await deleteNotify(fid);
            if (res.ok && data.result?.successfulTokens?.includes(notify.token)) {
              counts.alerted++;
              next.lastAlertAt = new Date().toISOString();
            }
          }
        }
        await putWatch(next);
      } catch {
        counts.failed++;
      }
    }
    return NextResponse.json({ ok: true, ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, ...counts }, { status: 502 });
  }
}
