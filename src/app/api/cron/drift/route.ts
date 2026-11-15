import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, parseAbi } from "viem";
import { base } from "viem/chains";
import { baseTransport } from "@/lib/rpc";
import { kvEnabled } from "@/lib/kv";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { alertPctOf, computeDrift } from "@/lib/drift";
import { deleteNotify, getNotifies, getWatch, listWatchFids, putWatch, type DriftWatch } from "@/lib/driftWatch";

/**
 * Daily drift check (Vercel Cron, see vercel.json: 23:00 UTC Mon–Fri = 18:00/19:00 New York, after the close
 * and the NAV update, in winter and summer time). For each watched wallet: read its stock balances and the
 * Chainlink NAV on Base, compare with the saved target, and send one mini app notification when the basket
 * goes off target (again at most every REMIND_DAYS while it stays off). Never trades.
 * Needs CRON_SECRET (Vercel Cron sends it); without it the check doesn't run. The response holds counts only.
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

/** Sends one notification to every client app the user enabled; drops tokens the host reports as invalid */
async function notify(fid: number, today: string, title: string, body: string): Promise<boolean> {
  const targets = await getNotifies(fid);
  let delivered = false;
  for (const n of targets) {
    try {
      const res = await fetch(n.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: `drift-${fid}-${today}`, title: title.slice(0, 32), body: body.slice(0, 128), targetUrl: `${SITE}/?tab=portfolio`, tokens: [n.token] }),
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json().catch(() => ({}))) as { result?: { successfulTokens?: string[]; invalidTokens?: string[] } };
      if (data.result?.invalidTokens?.includes(n.token)) await deleteNotify(fid, n.url);
      if (res.ok && data.result?.successfulTokens?.includes(n.token)) delivered = true;
    } catch {
      // this client failed; the others still get it
    }
  }
  return delivered;
}

export async function GET(req: NextRequest) {
  // Vercel Cron sends "Authorization: Bearer $CRON_SECRET"; without a secret nobody may start the check
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: true, skipped: "CRON_SECRET not set" });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  if (!kvEnabled()) return NextResponse.json({ ok: true, skipped: "storage not configured" });

  const started = Date.now();
  const counts = { watches: 0, checked: 0, off: 0, alerted: 0, skipped: 0, failed: 0 };
  try {
    const all = await listWatchFids();
    counts.watches = all.length;
    if (!all.length) return NextResponse.json({ ok: true, ...counts });
    const nav = await navPrices();
    const today = new Date().toISOString().slice(0, 10);
    // Start at a different place each day, so if the time budget runs out it is never the same users who wait
    const shift = Math.floor(Date.now() / 86_400_000) % all.length;
    const fids = [...all.slice(shift), ...all.slice(0, shift)];

    const checkOne = async (fid: number) => {
      try {
        const w = await getWatch(fid);
        if (!w) return;
        const held = await holdings(w.address, nav);
        if (!held || held.some((h) => h.missingPrice)) {
          counts.skipped++;
          return;
        }
        counts.checked++;
        const drift = computeDrift(held, w.target.weights, w.target.maxWeightPct);
        const isOff = drift !== null && (drift.driftPct >= alertPctOf(w.target) || drift.breaches.length > 0);
        const next: DriftWatch = { ...w, lastCheckAt: new Date().toISOString(), lastState: isOff ? "off" : "ok" };
        if (isOff && drift) {
          counts.off++;
          const since = w.lastAlertAt ? Date.now() - Date.parse(w.lastAlertAt) : Infinity;
          const due = w.lastState !== "off" || since > REMIND_DAYS * 86_400_000;
          if (due) {
            const { title, body } = message(w, drift);
            if (await notify(fid, today, title, body)) {
              counts.alerted++;
              next.lastAlertAt = new Date().toISOString();
            } else {
              // Not delivered (no token yet, host error): keep the previous state so tomorrow tries again
              next.lastState = w.lastState;
            }
          }
        }
        await putWatch(next);
      } catch {
        counts.failed++;
      }
    };
    // Five wallets at a time keeps RPC and storage load modest while finishing well inside the budget
    for (let i = 0; i < fids.length && Date.now() - started < BUDGET_MS; i += 5) await Promise.all(fids.slice(i, i + 5).map(checkOne));
    return NextResponse.json({ ok: true, ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, ...counts }, { status: 502 });
  }
}
