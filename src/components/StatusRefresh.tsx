"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** Re-runs the status checks every 60s (server refresh) and shows how old the shown result is. */
export function StatusRefresh({ checkedAt }: { checkedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Start from the check time itself so the server and browser render the same text (no hydration mismatch)
  const [now, setNow] = useState(() => new Date(checkedAt).getTime());

  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(() => startTransition(() => router.refresh()), 60_000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router]);

  const age = Math.max(0, Math.round((now - new Date(checkedAt).getTime()) / 1000));
  const ageText = age < 60 ? `${age}s ago` : `${Math.floor(age / 60)} min ago`;
  return (
    <div className="flex items-center gap-3 text-xs text-slate-400">
      <span>
        Checked <span className="font-mono text-slate-200">{ageText}</span> · refreshes every minute
      </span>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Checking…" : "Refresh"}
      </button>
    </div>
  );
}
