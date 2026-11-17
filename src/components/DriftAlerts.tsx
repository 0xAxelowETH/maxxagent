"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import type { SavedTarget } from "@/lib/drift";

type Sdk = (typeof import("@farcaster/miniapp-sdk"))["sdk"];
type Status = { watching: boolean; notifications: boolean; alertPct?: number; lastCheckAt?: string; address?: string };

/**
 * Stops the server-side watch when the user removes their target (inside a mini app only; elsewhere there is
 * none to stop). Best effort: a failure leaves the daily check to find no matching target in the browser.
 */
export async function stopDriftAlerts(): Promise<void> {
  try {
    const framed = window.self !== window.top || "ReactNativeWebView" in window;
    if (!framed) return;
    const { sdk } = await import("@farcaster/miniapp-sdk");
    if (!(await sdk.isInMiniApp())) return;
    await sdk.quickAuth.fetch("/api/watch", { method: "DELETE" });
  } catch {
    // nothing to do
  }
}

/**
 * Daily drift alerts through the Farcaster mini app: the agent checks this wallet against the target after each
 * US trading day and sends a notification when it drifts past the user's threshold. Read-only; nothing trades.
 * Outside a mini app it only explains where to turn alerts on.
 */
export function DriftAlerts({ address, target, alertPct }: { address: string; target: SavedTarget; alertPct: number }) {
  const [sdk, setSdk] = useState<Sdk | null>(null);
  const [checked, setChecked] = useState(false);
  const [available, setAvailable] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const call = useCallback(
    async (s: Sdk, method: "GET" | "POST" | "DELETE", body?: unknown) => {
      const res = await s.quickAuth.fetch("/api/watch", {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) setAvailable(false);
      if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
      return data as Status;
    },
    []
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const framed = window.self !== window.top || "ReactNativeWebView" in window;
        if (!framed) return;
        const { sdk } = await import("@farcaster/miniapp-sdk");
        if (!(await sdk.isInMiniApp())) return;
        if (!alive) return;
        setSdk(sdk);
        const st = await call(sdk, "GET").catch(() => null);
        if (alive && st) setStatus(st);
      } finally {
        if (alive) setChecked(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [call]);

  const watchingThis = Boolean(status?.watching && status.address?.toLowerCase() === address.toLowerCase());

  // Keep the server's copy in step when the threshold or the target changes here
  const sig = `${alertPct}|${JSON.stringify(target.weights)}|${target.maxWeightPct ?? ""}`;
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!sdk || !watchingThis) return;
    if (synced.current === null) {
      synced.current = sig; // first render after loading the status: nothing changed yet
      return;
    }
    if (synced.current === sig) return;
    const prevSig = synced.current;
    synced.current = sig;
    call(sdk, "POST", { address, target, alertPct })
      .then((st) => setStatus((p) => ({ ...p, ...st, address })))
      .catch(() => {
        if (synced.current === sig) synced.current = prevSig;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, sdk, watchingThis]);

  const turnOn = async () => {
    if (!sdk) return;
    setBusy(true);
    setError("");
    try {
      // Asks the user to add MAXXAGENT and allow notifications (the host shows its own prompt)
      let notificationDetails: unknown;
      try {
        notificationDetails = (await sdk.actions.addMiniApp())?.notificationDetails;
      } catch {
        // already added, or the user said no: the server may still hold a token from the webhook
      }
      if (!notificationDetails) notificationDetails = (await sdk.context)?.client?.notificationDetails;
      const st = await call(sdk, "POST", { address, target, alertPct, notificationDetails });
      synced.current = sig;
      setStatus({ ...st, address });
      if (!st.notifications) setError("Alerts are saved, but notifications are off. Turn on notifications for MAXXAGENT in your Farcaster app.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn on alerts.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!sdk) return;
    setBusy(true);
    setError("");
    try {
      await call(sdk, "DELETE");
      setStatus((p) => ({ ...(p ?? { notifications: false }), watching: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn off alerts.");
    } finally {
      setBusy(false);
    }
  };

  if (!checked || !available) return null;

  if (!sdk)
    return (
      <p className="text-[11px] text-slate-400" data-testid="drift-alerts-hint">
        <Bell className="mr-1 inline h-3 w-3 text-cyan-300" />
        Want the agent to watch this daily? Open MAXXAGENT as a mini app in Farcaster or the Base app and turn on drift alerts.
      </p>
    );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2" data-testid="drift-alerts">
      {watchingThis ? (
        <>
          <p className="flex-1 min-w-[12rem] text-[11px] text-cyan-100">
            <Bell className="mr-1 inline h-3 w-3" />
            <strong>Agent is watching.</strong> Checked after each US trading day; you get a notification when it is {alertPct}% off or
            breaks a limit.
            {status?.lastCheckAt ? ` Last check ${new Date(status.lastCheckAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.` : ""}
          </p>
          <button
            onClick={turnOff}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-rose-400 hover:text-rose-200 cursor-pointer disabled:opacity-50"
          >
            <BellOff className="h-3 w-3" />
            Stop alerts
          </button>
        </>
      ) : (
        <>
          <p className="flex-1 min-w-[12rem] text-[11px] text-cyan-100">Let the agent check this target every trading day and notify you when it drifts.</p>
          <button
            onClick={turnOn}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-cyan-500 px-3 py-1.5 text-[11px] font-bold text-slate-950 hover:bg-cyan-400 cursor-pointer disabled:opacity-50"
          >
            <Bell className="h-3 w-3" />
            {busy ? "Turning on…" : "Alert me"}
          </button>
        </>
      )}
      {error && <p className="w-full text-[11px] text-amber-200">{error}</p>}
    </div>
  );
}
