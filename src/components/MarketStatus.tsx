"use client";

import { useEffect, useState } from "react";
import { usMarketStatus, type MarketState } from "@/lib/marketHours";

const DOT: Record<MarketState, string> = {
  open: "bg-emerald-400",
  pre: "bg-amber-400",
  after: "bg-amber-400",
  closed: "bg-slate-500",
  weekend: "bg-slate-500",
  holiday: "bg-slate-500",
};

/** Live US market session badge (client-only: the server's clock/timezone must not decide the first paint). */
export function MarketStatus({ showDetail = false, className = "" }: { showDetail?: boolean; className?: string }) {
  const [status, setStatus] = useState<ReturnType<typeof usMarketStatus> | null>(null);
  useEffect(() => {
    const tick = () => setStatus(usMarketStatus());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!status) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 ${className}`} title={status.detail} data-testid="market-status">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[status.state]} ${status.state === "open" ? "animate-pulse" : ""}`} />
      <span className="font-semibold text-slate-200 whitespace-nowrap">{status.label}</span>
      {/* the explanation goes on its own line instead of squeezing into a second column */}
      {showDetail && <span className="basis-full pl-3 text-slate-400">{status.detail}</span>}
    </span>
  );
}
