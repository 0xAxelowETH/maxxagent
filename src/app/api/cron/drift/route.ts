import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createPublicClient, parseAbi } from "viem";
import { base } from "viem/chains";
import { baseTransport } from "@/lib/rpc";
import { kv, kvEnabled } from "@/lib/kv";
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
  const maxAgeSec = 4 * 86_400; // allow weekends + long holidays without false skips
  const nowSec = Math.floor(Date.now() / 1000);
  BASE_TOKENIZED_STOCKS.forEach((s, i) => {
    const r = res[i];
    if (r.status === "success") {
      const [roundId, answer, , updatedAt, answeredInRound] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
      if (answer > 0n && updatedAt > 0n && answeredInRound >= roundId && nowSec - Number(updatedAt) <= maxAgeSec) {
        out[s.symbol] = Number(answer) / 1e8;
      }
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

/** Sends one notification to every client app the user enabled; drops dead URLs and invalid tokens */
async function notify(fid: number, today: string, title: string, body: string): Promise<boolean> {
  const targets = await getNotifies(fid);
  if (!targets.length) return false;
  const results = await Promise.allSettled(
    targets.map(async (n) => {
      const res = await fetch(n.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: `drift-${fid}-${today}`, title: title.slice(0, 32), body: body.slice(0, 128), targetUrl: `${SITE}/?tab=portfolio`, tokens: [n.token] }),
        signal: AbortSignal.timeout(4000),
      });
      const data = (await res.json().catch(() => null)) as { result?: { successfulTokens?: string[]; invalidTokens?: string[] } } | null;
      if (res.status === 404 || res.status === 410 || data?.result?.invalidTokens?.includes(n.token)) {
        await deleteNotify(fid, n.url);
      }
      return Boolean(res.ok && data?.result?.successfulTokens?.includes(n.token));
    })
  );
  return results.some((r) => r.status === "fulfilled" && r.value);
}

function secretsEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

export async function GET(req: NextRequest) {
  // Vercel Cron sends "Authorization: Bearer $CRON_SECRET"; without a secret nobody may start the check
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: true, skipped: "CRON_SECRET not set" });
  const auth = req.headers.get("authorization") || "";
  if (!secretsEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ ok: false }, { status: 401 });
  if (!kvEnabled()) return NextResponse.json({ ok: true, skipped: "storage not configured" });
  const lock = await kv<string | null>("SET", "cron:drift:lock", "1", "NX", "EX", 55).catch(() => null);
  if (lock !== "OK") return NextResponse.json({ ok: true, skipped: "already running" }, { headers: { "Cache-Control": "no-store" } });

  const started = Date.now();
  const counts = { watches: 0, checked: 0, off: 0, alerted: 0, skipped: 0, failed: 0 };
  try {
    const all = await listWatchFids();
    counts.watches = all.length;
    if (!all.length) return NextResponse.json({ ok: true, ...counts });
    const nav = await navPrices();
    const today = new Date().toISOString().slice(0, 10);
    // Continue from the last saved cursor so every wallet gets checked fairly across runs
    const rawCursor = Number((await kv<string | null>("GET", "cron:drift:cursor").catch(() => null)) || 0);
    const shift = Number.isFinite(rawCursor) && rawCursor >= 0 ? rawCursor % all.length : 0;
    const fids = [...all.slice(shift), ...all.slice(0, shift)];

    const checkOne = async (fid: number) => {
      try {
        const w = await getWatch(fid);
        if (!w) {
          await kv("SREM", "watch:fids", fid).catch(() => {});
          return;
        }
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
          const parsedAlertAt = w.lastAlertAt ? Date.parse(w.lastAlertAt) : NaN;
          const since = Number.isFinite(parsedAlertAt) ? Date.now() - parsedAlertAt : Infinity;
          // 1h jitter buffer so cron schedule drift doesn't push a 3-day reminder to day 4
          const due = w.lastState !== "off" || since > REMIND_DAYS * 86_400_000 - 3_600_000;
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
        // Re-check existence and target/address equality before writing so concurrent updates aren't clobbered
        const latest = await getWatch(fid);
        if (latest && latest.address === w.address && JSON.stringify(latest.target) === JSON.stringify(w.target)) {
          await putWatch(next);
        }
      } catch {
        counts.failed++;
      }
    };
    // Five wallets at a time keeps RPC and storage load modest while finishing well inside the budget
    let processed = 0;
    for (let i = 0; i < fids.length && Date.now() - started < BUDGET_MS; i += 5) {
      const batch = fids.slice(i, i + 5);
      await Promise.all(batch.map(checkOne));
      processed += batch.length;
    }
    await kv("SET", "cron:drift:cursor", String((shift + processed) % all.length)).catch(() => {});
    return NextResponse.json({ ok: true, ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, ...counts }, { status: 502 });
  }
}
