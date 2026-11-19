"use client";

import React from "react";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";

export const STOCK_LOGO_MAP: Record<string, string> = Object.fromEntries(
  BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s.logoUrl])
);

export const STOCK_COLOR_MAP: Record<string, string> = Object.fromEntries(
  BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s.color])
);

/**
 * Interactive SVG Ring / Donut Chart for B20 Portfolio & Index Allocations
 */
export function PortfolioDonutChart({
  items,
  centerLabel,
  centerValue,
}: {
  items: { symbol: string; weightBps: number; color: string; logoUrl?: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const totalBps = Math.max(
    1,
    items.reduce((acc, i) => acc + i.weightBps, 0)
  );
  let cumulativeFraction = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="relative h-40 w-40 shrink-0 flex items-center justify-center">
        <svg viewBox="0 0 160 160" className="h-40 w-40 -rotate-90">
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="transparent"
            stroke="#1e293b"
            strokeWidth="16"
          />
          {items.map((item) => {
            const frac = item.weightBps / totalBps;
            const dash = Math.max(0, frac * circumference - 2.5);
            const offset = -cumulativeFraction * circumference;
            cumulativeFraction += frac;
            return (
              <circle
                key={item.symbol}
                cx="80"
                cy="80"
                r={radius}
                fill="transparent"
                stroke={item.color}
                strokeWidth="16"
                strokeDasharray={`${dash} ${circumference}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
            {centerLabel}
          </span>
          <span className="font-mono text-sm font-extrabold text-white mt-0.5">
            {centerValue}
          </span>
        </div>
      </div>

      {/* auto-fill keeps each legend item at least 150px wide so tickers never truncate */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 flex-1 w-full min-w-0">
        {items.map((item) => (
          <div
            key={item.symbol}
            className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-[#050914]/90 px-2.5 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              {item.logoUrl && (
                <img
                  src={item.logoUrl}
                  alt={item.symbol}
                  className="h-4 w-4 rounded-full object-cover shrink-0"
                />
              )}
              <span className="font-mono text-xs font-bold text-white truncate">
                {item.symbol}
              </span>
            </div>
            <span className="font-mono text-xs font-semibold text-cyan-300 shrink-0">
              {(item.weightBps / 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
