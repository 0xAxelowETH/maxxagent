import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@farcaster/quick-auth";
import { kvEnabled } from "@/lib/kv";
import { ALERT_PCT_CHOICES, alertPctOf, parseSavedTarget, type SavedTarget } from "@/lib/drift";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { deleteWatch, getNotifies, getWatch, putWatch, setNotify, validNotifyDetails } from "@/lib/driftWatch";

/**
 * Drift alerts for one Farcaster user. Every call carries a Quick Auth token (from the mini app), which proves
 * the FID; the watch is stored under that FID only. GET = status, POST = turn on / update, DELETE = turn off.
 */
export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, "");
const DOMAIN = (() => {
  try {
    return new URL(SITE).host;
  } catch {
    return "maxxagent.xyz";
  }
})();
const quickAuth = createClient();

async function fidFrom(req: NextRequest): Promise<number | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const payload = await quickAuth.verifyJwt({ token, domain: DOMAIN });
    const fid = Number(payload.sub);
    return Number.isInteger(fid) && fid > 0 ? fid : null;
  } catch {
    return null;
  }
}

const off = () => NextResponse.json({ ok: false, available: false, error: "Alerts are not set up on this server yet." }, { status: 503 });
const unauthorized = () => NextResponse.json({ ok: false, error: "Open MAXXAGENT as a Farcaster mini app to use alerts." }, { status: 401 });

export async function GET(req: NextRequest) {
  if (!kvEnabled()) return off();
  const fid = await fidFrom(req);
  if (!fid) return unauthorized();
  try {
    const [w, n] = await Promise.all([getWatch(fid), getNotifies(fid)]);
    return NextResponse.json(
      {
        ok: true,
        available: true,
        watching: Boolean(w),
        address: w?.address,
        alertPct: w ? alertPctOf(w.target) : undefined,
        target: w ? { weights: w.target.weights, maxWeightPct: w.target.maxWeightPct } : undefined,
        notifications: n.length > 0,
        lastCheckAt: w?.lastCheckAt,
        lastAlertAt: w?.lastAlertAt,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Could not read your alert settings. Try again." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!kvEnabled()) return off();
  const fid = await fidFrom(req);
  if (!fid) return unauthorized();
  const len = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(len) && len > 16_384) return NextResponse.json({ ok: false, error: "Request body too large." }, { status: 413 });
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > 16_384) return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: raw.length > 16_384 ? 413 : 400 });
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const address = typeof body?.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(body.address) ? (body.address as `0x${string}`) : null;
  const parsed = parseSavedTarget(body?.target, BASE_TOKENIZED_STOCKS.map((s) => s.symbol));
  if (!address || !parsed) return NextResponse.json({ ok: false, error: "A wallet and a saved target are needed." }, { status: 400 });
  // The threshold is part of the target (one source of truth); an older client may still send it separately
  const target: SavedTarget = { ...parsed, alertPct: parsed.alertPct ?? (ALERT_PCT_CHOICES.includes(Number(body?.alertPct)) ? Number(body?.alertPct) : undefined) };
  try {
    const prev = await getWatch(fid);
    // Same wallet and the very same rules (weights, limit, threshold): keep the alert history; anything else starts fresh
    const rules = (t: SavedTarget) => JSON.stringify([t.weights, t.maxWeightPct ?? null, alertPctOf(t)]);
    const same = prev && prev.address.toLowerCase() === address.toLowerCase() && rules(prev.target) === rules(target);
    await putWatch({
      fid,
      address,
      target,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
      ...(same ? { lastState: prev.lastState, lastCheckAt: prev.lastCheckAt, lastAlertAt: prev.lastAlertAt } : {}),
    });
    const details = validNotifyDetails(body?.notificationDetails);
    if (details) await setNotify(fid, details);
    const notifications = Boolean(details) || (await getNotifies(fid)).length > 0;
    return NextResponse.json({ ok: true, watching: true, alertPct: alertPctOf(target), notifications });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not save your alert. Try again." }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!kvEnabled()) return off();
  const fid = await fidFrom(req);
  if (!fid) return unauthorized();
  try {
    await deleteWatch(fid);
    return NextResponse.json({ ok: true, watching: false });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not turn the alert off. Try again." }, { status: 502 });
  }
}
