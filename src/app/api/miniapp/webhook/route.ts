import { NextRequest, NextResponse } from "next/server";
import { createHash, createPublicKey, verify } from "node:crypto";
import { kv, kvEnabled } from "@/lib/kv";
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

const b64url = (s: string): Buffer | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const buf = Buffer.from(s, "base64url");
  return buf.toString("base64url") === s ? buf : null;
};
const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

function signed(body: { header: string; payload: string; signature: string }): { fid: number; key: string; payload: Record<string, unknown> } | null {
  try {
    const hdrBuf = b64url(body.header);
    const payBuf = b64url(body.payload);
    const sigBuf = b64url(body.signature);
    if (!hdrBuf || !payBuf || !sigBuf) return null;
    const header = JSON.parse(hdrBuf.toString("utf8")) as { fid?: number; key?: string } | null;
    const payload = JSON.parse(payBuf.toString("utf8")) as Record<string, unknown> | null;
    if (!header || typeof header !== "object" || Array.isArray(header)) return null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const fid = Number(header.fid);
    const key = String(header.key || "").replace(/^0x/, "");
    if (!Number.isSafeInteger(fid) || fid <= 0 || !/^[0-9a-fA-F]{64}$/.test(key)) return null;
    const pub = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(key, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(`${body.header}.${body.payload}`), pub, sigBuf) ? { fid, key, payload } : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const len = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(len) && len > 16_384) return NextResponse.json({ ok: false }, { status: 413 });
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > 16_384) return NextResponse.json({ ok: false }, { status: raw.length > 16_384 ? 413 : 400 });
  let body: { header?: unknown; payload?: unknown; signature?: unknown } | null = null;
  try {
    body = JSON.parse(raw) as { header?: unknown; payload?: unknown; signature?: unknown };
  } catch {
    body = null;
  }
  if (!body || typeof body.header !== "string" || typeof body.payload !== "string" || typeof body.signature !== "string") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const v = signed({ header: body.header, payload: body.payload, signature: body.signature });
  if (!v) return NextResponse.json({ ok: false }, { status: 401 });
  if (!kvEnabled()) return NextResponse.json({ ok: true, stored: false });
  const event = v.payload.event;
  if (event !== "miniapp_added" && event !== "notifications_enabled") return NextResponse.json({ ok: true });
  const details = validNotifyDetails(v.payload.notificationDetails);
  if (!details) return NextResponse.json({ ok: true });
  try {
    // Verify Farcaster key ownership BEFORE checking getWatch(fid) so unauthenticated callers cannot enumerate FIDs
    if (!(await isAppKeyOf(v.fid, v.key))) return NextResponse.json({ ok: false }, { status: 401 });
    if (!(await getWatch(v.fid))) return NextResponse.json({ ok: true, stored: false }); // no drift alert on: nothing to keep
    // Replay guard over the immutable signed payload (header.payload); clean up if setNotify throws
    const sigDigest = createHash("sha256").update(`${body.header}.${body.payload}`).digest("hex").slice(0, 32);
    const seenKey = `wh:seen:${sigDigest}`;
    const fresh = await kv("SET", seenKey, "1", "EX", 86_400, "NX");
    if (fresh !== "OK") return NextResponse.json({ ok: true, replayed: true });
    try {
      await setNotify(v.fid, details);
    } catch (e) {
      await kv("DEL", seenKey).catch(() => {});
      throw e;
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
