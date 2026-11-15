import { kv, kvGetJson, kvSetJson } from "./kv";
import { ALERT_PCT_CHOICES, type SavedTarget } from "./drift";

/**
 * Server-side drift watch: a Farcaster user (verified FID) asks the agent to check one wallet against a
 * saved target every trading day and send a mini app notification when it drifts past their threshold.
 * Read-only: the agent never trades; the notification only opens the normal rebalance plan.
 */
export const ALERT_CHOICES = ALERT_PCT_CHOICES;
export const DEFAULT_ALERT_PCT = 5;

export interface DriftWatch {
  fid: number;
  address: `0x${string}`;
  target: SavedTarget;
  /** drift (share of the stocks that would have to move) that triggers an alert */
  alertPct: number;
  createdAt: string;
  /** state at the last daily check, so an alert goes out when the basket goes off target, not every day */
  lastState?: "ok" | "off";
  lastCheckAt?: string;
  lastAlertAt?: string;
}

export interface NotifyDetails {
  url: string;
  token: string;
}

const watchKey = (fid: number) => `watch:${fid}`;
const notifyKey = (fid: number) => `notify:${fid}`;
const SET = "watch:fids";

/** Notification URLs come from the client or the webhook: only send to known mini app hosts, over https */
const NOTIFY_HOSTS = ["farcaster.xyz", "warpcast.com", "base.app", "base.org", "coinbase.com", "neynar.com"];
export function validNotifyDetails(d: unknown): NotifyDetails | null {
  if (!d || typeof d !== "object") return null;
  const { url, token } = d as Record<string, unknown>;
  if (typeof url !== "string" || typeof token !== "string" || token.length < 8 || token.length > 512) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (!NOTIFY_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return null;
    return { url: u.toString(), token };
  } catch {
    return null;
  }
}

export const getWatch = (fid: number) => kvGetJson<DriftWatch>(watchKey(fid));
export async function putWatch(w: DriftWatch) {
  await kvSetJson(watchKey(w.fid), w);
  await kv("SADD", SET, w.fid);
}
export async function deleteWatch(fid: number) {
  await kv("DEL", watchKey(fid));
  await kv("SREM", SET, fid);
}
export const listWatchFids = async () => ((await kv<string[]>("SMEMBERS", SET)) || []).map(Number).filter((n) => n > 0);

export const getNotify = (fid: number) => kvGetJson<NotifyDetails>(notifyKey(fid));
export const setNotify = (fid: number, d: NotifyDetails) => kvSetJson(notifyKey(fid), d);
export const deleteNotify = (fid: number) => kv("DEL", notifyKey(fid));
