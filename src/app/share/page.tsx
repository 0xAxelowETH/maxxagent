"use client";

import { useEffect, useState } from "react";
import { parseMandate } from "@/lib/mandate";

/**
 * castShareUrl target: a user shares a cast to MAXXAGENT from their Farcaster client.
 * The stocks the cast mentions ("$NVDA and Apple…") open as a stock page (one) or an equal-weight basket
 * (several); anything else opens the home page. Outside a mini app this simply redirects home.
 */
export default function SharePage() {
  const [note, setNote] = useState("Reading the cast…");
  useEffect(() => {
    let done = false;
    const go = (url: string) => {
      if (done) return;
      done = true;
      window.location.replace(url);
    };
    const timer = setTimeout(() => go("/"), 4000);
    (async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        if (!(await sdk.isInMiniApp())) return go("/");
        const ctx = await sdk.context;
        const text = ctx?.location?.type === "cast_share" ? ctx.location.cast.text || "" : "";
        const picks = parseMandate(text).include.slice(0, 10);
        if (picks.length === 1) return go(`/stock/${picks[0]}`);
        if (picks.length > 1) {
          const base = Math.floor(100 / picks.length);
          const weights = picks.map((s, i) => `${s}-${i === 0 ? 100 - base * (picks.length - 1) : base}`);
          setNote(`Opening a basket of ${picks.join(", ")}…`);
          return go(`/?basket=${weights.join(",")}`);
        }
        go("/");
      } catch {
        go("/");
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => clearTimeout(timer);
  }, []);
  return (
    <main className="min-h-screen bg-[#03060e] grid place-items-center px-4 text-sm text-slate-400">
      {note}
    </main>
  );
}
