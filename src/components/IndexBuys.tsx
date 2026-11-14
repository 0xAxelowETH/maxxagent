"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Row {
  id: number;
  buys: number;
  volumeUsd: number;
  wallets: number;
}

/**
 * How often a published index was bought, counted from onchain swaps (see src/lib/indexMatch.ts).
 * Shows nothing while loading or when the stats can't be read: never a made-up number.
 */
export function IndexBuys({ id }: { id: number }) {
  const [row, setRow] = useState<Row | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.ok || !Array.isArray(d.indexBuys)) return;
        setRow((d.indexBuys as Row[]).find((x) => x.id === id) ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (row === undefined) return null;
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 text-xs text-slate-300" data-testid="index-buys">
      {row ? (
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <span>
            <strong className="font-mono text-base text-white">{row.buys}</strong> {row.buys === 1 ? "buy" : "buys"}
          </span>
          <span>
            <strong className="font-mono text-base text-white">${row.volumeUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong> volume
          </span>
          <span>
            <strong className="font-mono text-base text-white">{row.wallets}</strong> {row.wallets === 1 ? "wallet" : "wallets"}
          </span>
        </div>
      ) : (
        <div className="font-semibold text-white">No buys yet. Be the first.</div>
      )}
      <p className="mt-1.5 text-[11px] text-slate-500">
        Counted from onchain swaps made through MAXXAGENT that match this index&apos;s stocks and weights. The team&apos;s test wallet is
        excluded.{" "}
        <Link href="/stats" className="text-cyan-300 underline">
          Live stats
        </Link>
      </p>
    </div>
  );
}
