import { NextRequest, NextResponse } from "next/server";
import { createPublicKey, verify } from "node:crypto";
import { kvEnabled } from "@/lib/kv";
import { deleteNotify, setNotify, validNotifyDetails } from "@/lib/driftWatch";

/**
 * Mini app webhook (manifest `webhookUrl`): Farcaster clients post signed events when a user adds or removes
 * MAXXAGENT or turns its notifications on or off. The body is a JSON Farcaster Signature
 * {header, payload, signature}; the Ed25519 signature is checked against the app key in the header.
 * Only notification tokens are stored here (per FID); what to watch comes from /api/watch.
 */
export const dynamic = "force-dynamic";

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

function verified(body: { header: string; payload: string; signature: string }): { fid: number; payload: Record<string, unknown> } | null {
  try {
    const header = JSON.parse(b64url(body.header).toString("utf8")) as { fid?: number; key?: string };
    const payload = JSON.parse(b64url(body.payload).toString("utf8")) as Record<string, unknown>;
    const fid = Number(header.fid);
    const keyHex = String(header.key || "").replace(/^0x/, "");
    if (!Number.isInteger(fid) || fid <= 0 || !/^[0-9a-fA-F]{64}$/.test(keyHex)) return null;
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(keyHex, "hex")]), format: "der", type: "spki" });
    const ok = verify(null, Buffer.from(`${body.header}.${body.payload}`), key, b64url(body.signature));
    return ok ? { fid, payload } : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { header?: string; payload?: string; signature?: string } | null;
  if (!body?.header || !body.payload || !body.signature) return NextResponse.json({ ok: false }, { status: 400 });
  const v = verified({ header: body.header, payload: body.payload, signature: body.signature });
  if (!v) return NextResponse.json({ ok: false }, { status: 401 });
  if (!kvEnabled()) return NextResponse.json({ ok: true, stored: false });
  try {
    const event = v.payload.event;
    if (event === "miniapp_added" || event === "notifications_enabled") {
      const details = validNotifyDetails(v.payload.notificationDetails);
      if (details) await setNotify(v.fid, details);
    } else if (event === "miniapp_removed" || event === "notifications_disabled") {
      await deleteNotify(v.fid);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
