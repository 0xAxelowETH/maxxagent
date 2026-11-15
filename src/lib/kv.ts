/**
 * Tiny Upstash Redis REST client (no SDK). Server only.
 * Vercel's Upstash integration sets KV_REST_API_URL / KV_REST_API_TOKEN; plain Upstash uses UPSTASH_REDIS_REST_*.
 * Without them every feature that needs shared storage (drift alerts) reports itself as off.
 */
const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export const kvEnabled = () => Boolean(KV_URL && KV_TOKEN);

/** Runs one Redis command, e.g. kv("SET", "key", "value") */
export async function kv<T = unknown>(...cmd: (string | number)[]): Promise<T> {
  if (!kvEnabled()) throw new Error("Shared storage is not configured");
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd.map(String)),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok || data.error) throw new Error(`Storage error (${res.status})`);
  return data.result as T;
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await kv<string | null>("GET", key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const kvSetJson = (key: string, value: unknown) => kv("SET", key, JSON.stringify(value));
