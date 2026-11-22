"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Coins } from "lucide-react";
import type { PairedToken } from "@/app/api/paired/route";

// One request per page view, shared by every panel and the Paired tab's first render
let pairedPromise: Promise<PairedToken[]> | null = null;
export function loadPairedTokens(force = false): Promise<PairedToken[]> {
  if (!pairedPromise || force)
    pairedPromise = fetch("/api/paired")
      .then((r) => r.json())
      .then((d) => (d?.ok && Array.isArray(d.tokens) ? (d.tokens as PairedToken[]) : []))
      .catch(() => {
        pairedPromise = null;
        return [];
      });
  return pairedPromise;
}

export const usdShort = (n: number) =>
  n >= 1e9
    ? `$${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
      ? `$${(n / 1e6).toFixed(2)}M`
      : n >= 1e4
        ? `$${Math.round(n / 1e3)}K`
        : n >= 1e3
          ? `$${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`
          : `$${n.toFixed(0)}`;

/**
 * Under a stock's chart: the community tokens whose pools trade against this stock, linking to the Paired tab.
 * Renders nothing when no token passes the Paired tab's liquidity rules for this stock.
 */
export function PairedForStock({ symbol, onSeeAll }: { symbol: string; onSeeAll?: (symbol: string) => void }) {
  const [tokens, setTokens] = useState<PairedToken[] | null>(null);
  useEffect(() => {
    let off = false;
    loadPairedTokens().then((all) => !off && setTokens(all));
    return () => {
      off = true;
    };
  }, []);
  const mine = (tokens ?? []).filter((t) => t.stock === symbol).sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  if (mine.length === 0) return null;
  const totalLiq = mine.reduce((a, t) => a + t.liquidityUsd, 0);
  const seeAllCls = "shrink-0 text-[11px] font-semibold text-cyan-300 hover:text-white cursor-pointer";
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-3.5 space-y-2.5" data-testid="paired-for-stock">
      <div className="flex items-start justify-between gap-3">
        {/* Title and count stacked, "See all" on the right: stays tidy on a phone */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <Coins className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span>Community tokens paired with {symbol}</span>
          </div>
          <div className="mt-0.5 pl-5 font-mono text-[11px] font-semibold text-slate-400">
            {mine.length} token{mine.length > 1 ? "s" : ""} · {usdShort(totalLiq)} in pools
          </div>
        </div>
        {onSeeAll ? (
          <button type="button" onClick={() => onSeeAll(symbol)} className={seeAllCls}>
            See all →
          </button>
        ) : (
          <Link href={`/?tab=paired&pair=${encodeURIComponent(symbol)}`} className={seeAllCls}>
            See all →
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {mine.slice(0, 3).map((t) => (
          <a
            key={t.pairAddress}
            href={`https://dexscreener.com/base/${t.pairAddress}`}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-[#060b16] px-2.5 py-1.5 text-[11px] hover:border-amber-400/50"
            title={`$${t.token.symbol} / ${symbol} pool on DexScreener`}
          >
            {t.token.logoUrl ? (
              <img src={t.token.logoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-4 w-4 rounded-full object-cover" />
            ) : null}
            <span className="font-mono font-bold text-white">${t.token.symbol}</span>
            <span className="font-mono text-slate-400">{usdShort(t.liquidityUsd)}</span>
          </a>
        ))}
      </div>
      <p className="text-[10px] text-slate-500">Third-party tokens, not endorsed and not tradable here. Not financial advice.</p>
    </div>
  );
}
