import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@farcaster/quick-auth";
import { kvEnabled } from "@/lib/kv";
import { parseSavedTarget } from "@/lib/drift";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import {
  ALERT_CHOICES,
  DEFAULT_ALERT_PCT,
  deleteWatch,
  getNotify,
  getWatch,
  putWatch,
  setNotify,
  validNotifyDetails,
} from "@/lib/driftWatch";

/**
 * Drift alerts for one Farcaster user. Every call carries a Quick Auth token (from the mini app), which proves
 * the FID; the watch is stored under that FID only. GET = status, POST = turn on / update, DELETE = turn off.
 */
export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, "");
const DOMAIN = new URL(SITE).host;
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
    const [w, n] = await Promise.all([getWatch(fid), getNotify(fid)]);
    return NextResponse.json(
      {
        ok: true,
        available: true,
        watching: Boolean(w),
        address: w?.address,
        alertPct: w?.alertPct,
        notifications: Boolean(n),
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
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const address = typeof body?.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(body.address) ? (body.address as `0x${string}`) : null;
  const target = parseSavedTarget(body?.target, BASE_TOKENIZED_STOCKS.map((s) => s.symbol));
  const alertPct = ALERT_CHOICES.includes(Number(body?.alertPct)) ? Number(body?.alertPct) : DEFAULT_ALERT_PCT;
  if (!address || !target) return NextResponse.json({ ok: false, error: "A wallet and a saved target are needed." }, { status: 400 });
  try {
    const prev = await getWatch(fid);
    // A new wallet or target starts fresh; only the threshold changing keeps the last state
    const same = prev && prev.address.toLowerCase() === address.toLowerCase() && JSON.stringify(prev.target.weights) === JSON.stringify(target.weights);
    await putWatch({
      fid,
      address,
      target,
      alertPct,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
      ...(same ? { lastState: prev.lastState, lastCheckAt: prev.lastCheckAt, lastAlertAt: prev.lastAlertAt } : {}),
    });
    const details = validNotifyDetails(body?.notificationDetails);
    if (details) await setNotify(fid, details);
    const notifications = Boolean(details || (await getNotify(fid)));
    return NextResponse.json({ ok: true, watching: true, alertPct, notifications });
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
