import { createPublicClient, http, parseAbi } from "viem";
import { optimism } from "viem/chains";
import { kv, kvGetJson, kvSetJson } from "./kv";
import type { SavedTarget } from "./drift";

/**
 * Server-side drift watch: a Farcaster user (verified FID) asks the agent to check one wallet against a
 * saved target every trading day and send a mini app notification when it drifts past their threshold.
 * Read-only: the agent never trades; the notification only opens the normal rebalance plan.
 * The threshold lives in the target itself (SavedTarget.alertPct, see alertPctOf in drift.ts).
 */
export interface DriftWatch {
  fid: number;
  address: `0x${string}`;
  target: SavedTarget;
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
// One token per (FID, client app): Farcaster and the Base app each issue their own, so they are kept side by side
// in a hash keyed by the client's notification URL
const notifyKey = (fid: number) => `notify2:${fid}`;
const SET = "watch:fids";

/** Notification URLs come from the client or the webhook: only send to known mini app hosts, over https */
const NOTIFY_HOSTS = ["farcaster.xyz", "warpcast.com", "base.app", "base.org", "coinbase.com", "neynar.com"];
export function validNotifyDetails(d: unknown): NotifyDetails | null {
  if (!d || typeof d !== "object") return null;
  const { url, token } = d as Record<string, unknown>;
  if (typeof url !== "string" || typeof token !== "string" || url.length > 300 || token.length < 8 || token.length > 512) return null;
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
  await kv("DEL", notifyKey(fid));
  await kv("SREM", SET, fid);
}
export const listWatchFids = async () => ((await kv<string[]>("SMEMBERS", SET)) || []).map(Number).filter((n) => n > 0);

/** Every client app's token for this FID */
export async function getNotifies(fid: number): Promise<NotifyDetails[]> {
  const flat = (await kv<string[] | null>("HGETALL", notifyKey(fid))) || [];
  const out: NotifyDetails[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ url: flat[i], token: flat[i + 1] });
  return out;
}
const MAX_NOTIFY_PER_FID = 4;
export async function setNotify(fid: number, d: NotifyDetails) {
  const existing = await getNotifies(fid);
  if (existing.length >= MAX_NOTIFY_PER_FID && !existing.some((e) => e.url === d.url)) {
    await deleteNotify(fid, existing[0].url);
  }
  return kv("HSET", notifyKey(fid), d.url, d.token);
}
export const deleteNotify = (fid: number, url: string) => kv("HDEL", notifyKey(fid), url);

/**
 * Whether `keyHex` (Ed25519, 32 bytes) is an active app key of `fid` in Farcaster's Key Registry on Optimism.
 * Without this check anyone could sign webhook events with their own key and claim any FID.
 */
const KEY_REGISTRY = "0x00000000Fc1237824fb747aBDE0FF18990E59b7e";
const opClient = createPublicClient({ chain: optimism, transport: http(process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io", { timeout: 8000 }) });
const keyCache = new Map<string, { at: number; ok: boolean }>();
export async function isAppKeyOf(fid: number, keyHex: string): Promise<boolean> {
  const id = `${fid}:${keyHex.toLowerCase()}`;
  const hit = keyCache.get(id);
  const ttl = hit?.ok ? 300_000 : 15_000;
  if (hit && Date.now() - hit.at < ttl) return hit.ok;
  const data = await opClient.readContract({
    address: KEY_REGISTRY,
    abi: parseAbi(["function keyDataOf(uint256 fid, bytes key) view returns ((uint8 state, uint32 keyType))"]),
    functionName: "keyDataOf",
    args: [BigInt(fid), `0x${keyHex.replace(/^0x/, "")}`],
  });
  const ok = data.state === 1 && data.keyType === 1; // 1 = ADDED, keyType 1 = Ed25519
  keyCache.set(id, { at: Date.now(), ok });
  if (keyCache.size > 2000) {
    const oldest = keyCache.keys().next().value;
    if (oldest) keyCache.delete(oldest);
  }
  return ok;
}
