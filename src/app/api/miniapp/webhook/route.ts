import { NextRequest, NextResponse } from "next/server";
import { createPublicKey, verify } from "node:crypto";
import { kvEnabled } from "@/lib/kv";
import { getWatch, isAppKeyOf, setNotify, validNotifyDetails } from "@/lib/driftWatch";

/**
 * Mini app webhook (manifest `webhookUrl`): Farcaster clients post signed events when a user adds or removes
 * MAXXAGENT or turns its notifications on or off. The body is a JSON Farcaster Signature {header, payload,
 * signature}. Checked: the Ed25519 signature against the key in the header, and that this key is an active app key
 * of the claimed FID in Farcaster's Key Registry (else anyone could sign for any FID).
 *
 * Only users who turned on drift alerts (/api/watch) are stored. A token is stored per client app; "removed" and
 * "notifications off" events don't say which client sent them, so nothing is deleted here: the notification host
 * reports a dead token as invalid on the next send, and the daily check drops it then.
 */
export const dynamic = "force-dynamic";

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

function signed(body: { header: string; payload: string; signature: string }): { fid: number; key: string; payload: Record<string, unknown> } | null {
  try {
    const header = JSON.parse(b64url(body.header).toString("utf8")) as { fid?: number; key?: string };
    const payload = JSON.parse(b64url(body.payload).toString("utf8")) as Record<string, unknown>;
    const fid = Number(header.fid);
    const key = String(header.key || "").replace(/^0x/, "");
    if (!Number.isInteger(fid) || fid <= 0 || !/^[0-9a-fA-F]{64}$/.test(key)) return null;
    const pub = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(key, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(`${body.header}.${body.payload}`), pub, b64url(body.signature)) ? { fid, key, payload } : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { header?: string; payload?: string; signature?: string } | null;
  if (!body?.header || !body.payload || !body.signature) return NextResponse.json({ ok: false }, { status: 400 });
  const v = signed({ header: body.header, payload: body.payload, signature: body.signature });
  if (!v) return NextResponse.json({ ok: false }, { status: 401 });
  if (!kvEnabled()) return NextResponse.json({ ok: true, stored: false });
  const event = v.payload.event;
  if (event !== "miniapp_added" && event !== "notifications_enabled") return NextResponse.json({ ok: true });
  const details = validNotifyDetails(v.payload.notificationDetails);
  if (!details) return NextResponse.json({ ok: true });
  try {
    if (!(await getWatch(v.fid))) return NextResponse.json({ ok: true, stored: false }); // no drift alert on: nothing to keep
    if (!(await isAppKeyOf(v.fid, v.key))) return NextResponse.json({ ok: false }, { status: 401 });
    await setNotify(v.fid, details);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
