"use client";

import { useEffect, useState } from "react";
import { MaxxLoader } from "@/components/MaxxLoader";

interface Replay {
  from: number;
  to: number;
  points: [number, number][];
  basketPct: number;
  stocks: { symbol: string; pct: number }[];
  cashPct: number;
}

const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

/**
 * "If this mix had been held for the last ~30 days": the proposed weights replayed on daily Chainlink NAV closes,
 * cash flat. Clearly labelled hypothetical; it is past data, not a forecast.
 */
export function BasketReplay({ legs }: { legs: { symbol: string; pct: number }[] }) {
  const key = legs.map((l) => `${l.symbol}-${l.pct.toFixed(2)}`).join(",");
  const [data, setData] = useState<Replay | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!key) return;
    let off = false;
    setData(null);
    setError("");
    fetch(`/api/replay?basket=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((d) => !off && (d?.ok ? setData(d) : setError(d?.error || "Replay unavailable.")))
      .catch(() => !off && setError("Replay unavailable."));
    return () => {
      off = true;
    };
  }, [key]);

  if (error) return null;
  const W = 600;
  const H = 120;
  return (
    <section className="rounded-2xl border border-slate-800 bg-[#070b14] p-4" data-testid="basket-replay" aria-label="30-day replay">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-white">
          Replay: this mix over the last 30 days <span className="font-normal text-slate-400">(past prices, not a forecast)</span>
        </h3>
        {data && (
          <span className={`font-mono text-lg font-bold ${data.basketPct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{signed(data.basketPct)}</span>
        )}
      </div>
      {!data ? (
        <MaxxLoader className="mt-3" label="Replaying daily NAV closes…" />
      ) : (
        <>
          {(() => {
            const vs = data.points.map((p) => p[1]);
            const lo = Math.min(...vs, 100);
            const hi = Math.max(...vs, 100);
            const x = (i: number) => (i / (data.points.length - 1)) * W;
            const y = (v: number) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
            const d = data.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
            return (
              <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[120px] w-full" preserveAspectRatio="none" role="img" aria-label="Replay of the basket value">
                <line x1="0" x2={W} y1={y(100)} y2={y(100)} stroke="#334155" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                <path d={d} fill="none" stroke={data.basketPct >= 0 ? "#34d399" : "#fb7185"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
            );
          })()}
          <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
            <span>{day(data.from)} close</span>
            <span>{day(data.to)} close</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px]">
            {data.stocks.map((s) => (
              <span key={s.symbol} className={s.pct >= 0 ? "text-emerald-300" : "text-rose-300"}>
                <span className="text-slate-300">{s.symbol}</span> {signed(s.pct)}
              </span>
            ))}
            {data.cashPct > 0.5 && <span className="text-slate-400">cash {data.cashPct.toFixed(0)}% flat</span>}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            Hypothetical: these weights applied to each stock&apos;s daily Chainlink NAV close, cash unchanged. No swap costs or timing,
            so not a return anyone earned. Past moves don&apos;t predict future ones. Not financial advice.
          </p>
        </>
      )}
    </section>
  );
}
