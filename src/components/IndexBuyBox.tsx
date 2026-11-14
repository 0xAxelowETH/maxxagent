"use client";

import { UsdAmountInput } from "@/components/UsdAmountInput";
import { useState } from "react";
import { Copy, Zap } from "lucide-react";
import { MIN_BUY_USD } from "@/lib/tokenizedStocks";

/**
 * Amount + USDC/ETH picker for a published index. "Buy" opens the app with this index loaded in the
 * index builder (amount, payment and name prefilled); the user still reviews and signs there.
 */
export function IndexBuyBox({
  id,
  name,
  ticker,
  basket,
}: {
  id: number;
  name: string;
  ticker: string;
  /** "NVDAc-34,MSFTc-33,…" in percent, as used by share links */
  basket: string;
}) {
  const [amount, setAmount] = useState(20);
  const [pay, setPay] = useState<"usdc" | "eth">("usdc");
  const [copied, setCopied] = useState(false);
  // Every stock needs MIN_BUY_USD, so the smallest total depends on the smallest weight
  const smallestPct = Math.min(...basket.split(",").map((p) => Number(p.split("-")[1]) || 100));
  const minTotal = Math.ceil(((MIN_BUY_USD * 100) / smallestPct) * 100) / 100;
  const valid = amount >= minTotal && amount <= 10000;
  const href = `/?basket=${basket}&amount=${amount}&pay=${pay}&name=${encodeURIComponent(name)}&from=index-${id}`;

  return (
    <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/5 p-4 space-y-3">
      <div className="text-sm font-bold text-white">Buy {ticker}</div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
          <UsdAmountInput
            value={amount}
            onChange={setAmount}
            min={minTotal}
            className="w-28 rounded-xl border border-slate-700 bg-[#050811] py-2 pl-6 pr-2 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none"
            ariaLabel="Amount in USD"
          />
        </span>
        {[5, 10, 20, 50, 100].map((v) => (
          <button
            key={v}
            onClick={() => setAmount(v)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold cursor-pointer ${amount === v ? "border-emerald-400 bg-emerald-500/15 text-emerald-200" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}
          >
            ${v}
          </button>
        ))}
        <span className="inline-flex rounded-lg border border-slate-700 bg-[#040814] p-0.5 text-[11px]" role="group" aria-label="Pay with">
          {(["usdc", "eth"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setPay(t)}
              aria-pressed={pay === t}
              className={`rounded-md px-2.5 py-1 font-bold uppercase cursor-pointer ${pay === t ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
            >
              {t}
            </button>
          ))}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={valid ? href : undefined}
          aria-disabled={!valid}
          className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white ${valid ? "bg-emerald-600 hover:bg-emerald-500" : "bg-slate-700 opacity-60 pointer-events-none"}`}
        >
          <Zap className="h-4 w-4" />
          Buy ${amount.toFixed(2)} {pay === "eth" ? "in ETH" : "USDC"}
        </a>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${window.location.origin}/index/${id}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-200 hover:border-slate-500 cursor-pointer"
        >
          <Copy className="h-4 w-4" />
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
      <p className="text-[11px] text-slate-400">
        Opens MAXXAGENT with this index loaded. You review the order (estimate, minimum received, cost vs NAV) and
        sign each swap in your own wallet. Each stock needs at least $0.50, so this index starts at ${minTotal.toFixed(2)}.
      </p>
    </div>
  );
}
