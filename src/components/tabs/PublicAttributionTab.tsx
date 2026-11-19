"use client";

import React from "react";
import { CheckCircle2, Copy, ExternalLink, Flame, Terminal } from "lucide-react";
import { MaxxAgentMark } from "@/components/BrandLogo";
import { parseErc8021Calldata, toErc8021DataSuffix } from "@/lib/builderCode";
import { LiveTokenizedStock, STOCKS_MAXXING_PARTNERS } from "@/lib/tokenizedStocks";

export interface PublicAttributionTabProps {
  builderCode: string;
  attributedCalldata?: string;
  copiedKey: string;
  copyToClipboard: (text: string, key: string) => void;
  stocks: LiveTokenizedStock[];
  totalTvlUsd: number;
  dayNumber: number;
  setDayNumber: (d: number) => void;
  milestoneTitle: string;
  setMilestoneTitle: (s: string) => void;
}

export default function PublicAttributionTab({
  builderCode,
  attributedCalldata,
  copiedKey,
  copyToClipboard,
  stocks,
  totalTvlUsd,
  dayNumber,
  setDayNumber,
  milestoneTitle,
  setMilestoneTitle,
}: PublicAttributionTabProps) {

  const attributionInfo = toErc8021DataSuffix([builderCode]);
  const sampleDecoded = parseErc8021Calldata(attributedCalldata || attributionInfo.dataSuffix);

  const nvdaPrice = stocks.find((s) => s.symbol === "NVDAc")?.navPrice ?? 0;
  const tslaPrice = stocks.find((s) => s.symbol === "TSLAc")?.navPrice ?? 0;
  const spcxPrice = stocks.find((s) => s.symbol === "SPCXc")?.navPrice ?? 0;
  const nvdaMult = stocks.find((s) => s.symbol === "NVDAc")?.uiMultiplier ?? 1;

  const buildInPublicPost = `Day ${dayNumber} building MAXXAGENT for #StocksMaxxing on @base 🔵

✅ ${milestoneTitle}

Live from Base right now:
• $NVDAc NAV $${nvdaPrice.toFixed(2)} (multiplier ${nvdaMult.toFixed(6)}x)
• $TSLAc NAV $${tslaPrice.toFixed(2)}
• $SPCXc NAV $${spcxPrice.toFixed(2)}
• Tokenized stock TVL tracked: $${(totalTvlUsd / 1e6).toFixed(2)}M

Agent-picked baskets of tokenized stocks, bought from your own wallet. Not financial advice.
@buildonbase`;

  return (
    <div className="space-y-6">
      {/* For developers & judges: ERC-8021 attribution details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-300">
            <MaxxAgentMark size={14} />
            Every MAXXAGENT transaction carries our Builder Code
          </div>
          <h2 className="text-xl font-bold text-white">
            ERC-8021 Transaction Attribution Engine
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            Swaps, approvals and index publications sent from MAXXAGENT end with an{" "}
            <strong>ERC-8021</strong> <code className="text-emerald-300">dataSuffix</code> so the
            activity is attributed to this app. The suffix is ignored by contracts and costs a few
            gas units.
          </p>

          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              MAXXAGENT Builder Code (NEXT_PUBLIC_BASE_BUILDER_CODE)
            </label>
            <div className="flex gap-2">
              <div className="flex-1 rounded-xl border border-slate-700 bg-[#050811] px-4 py-2.5 font-mono text-sm text-emerald-400">
                {builderCode}
              </div>
              <button
                onClick={() => copyToClipboard(attributionInfo.dataSuffix, "builder-suffix")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition cursor-pointer"
              >
                <Copy className="h-4 w-4" />
                {copiedKey === "builder-suffix" ? "Copied Suffix!" : "Copy dataSuffix"}
              </button>
            </div>
          </div>

          {/* Byte-level Breakdown of ERC-8021 Suffix */}
          <div className="rounded-xl border border-slate-800 bg-[#050811] p-4 space-y-3 font-mono text-xs">
            <div className="text-slate-400 font-sans text-xs font-semibold">
              Live ERC-8021 Backward-Parsed Calldata Suffix Breakdown ({attributionInfo.byteLength} bytes):
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2.5">
                <div className="text-[10px] text-blue-300">1. ASCII Builder Code</div>
                <div className="text-white font-bold mt-1">
                  &quot;{attributionInfo.codes.join(",")}&quot;
                </div>
              </div>
              <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-2.5">
                <div className="text-[10px] text-purple-300">2. Length + Schema ID</div>
                <div className="text-white font-bold mt-1">
                  Len: {attributionInfo.codes.join(",").length}B | Schema: 0x00
                </div>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
                <div className="text-[10px] text-emerald-300">3. 16-Byte ERC-8021 Marker</div>
                <div className="text-emerald-300 font-bold mt-1 truncate">
                  0x8021802180218021...
                </div>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-800 text-[11px] text-emerald-300 break-all">
              Full dataSuffix: {attributionInfo.dataSuffix}
            </div>
          </div>

          <div className="rounded-xl border border-[#4C6FFF]/40 bg-[#4C6FFF]/10 p-4 space-y-2 text-[11px] text-slate-300">
            <div className="text-xs font-bold text-white">How to verify a MAXXAGENT transaction</div>
            <ol className="list-decimal list-inside space-y-1">
              <li>Buy a basket or publish an index (see the activity log below).</li>
              <li>Open the transaction on BaseScan → Input Data: it ends with <code className="text-emerald-300">80218021…8021</code>.</li>
              <li>
                Or paste the hash into{" "}
                <a href="https://builder-code-checker.vercel.app/" target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
                  builder-code-checker
                </a>
                .
              </li>
            </ol>
          </div>
        </div>

        {/* Right Column: Verifier & Code Snippet */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
            <Terminal className="h-4 w-4" />
            ERC-8021 Calldata Decoder & Verification
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#050811] p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Verification Status:</span>
              <span className="font-mono font-bold text-emerald-400">
                {sampleDecoded.isValid ? "VALID ERC-8021 SUFFIX" : "INVALID"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Decoded Builder Code(s):</span>
              <span className="font-mono font-bold text-white">
                {sampleDecoded.codes.join(", ")}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Registry Schema ID:</span>
              <span className="font-mono text-cyan-300">
                Schema {sampleDecoded.schemaId}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">
              How it is attached (see{" "}
              <code className="text-cyan-300">src/lib/builderCode.ts</code>):
            </div>
            <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-[#050811] p-3.5 font-mono text-[11px] text-slate-300 leading-relaxed">
{`import { Attribution } from "ox/erc8021";

const dataSuffix = Attribution.toDataSuffix({ codes: ["${builderCode}"] });

// viem >= 2.45: every write from this client is attributed
const walletClient = createWalletClient({
  chain: base,
  transport: custom(window.ethereum),
  dataSuffix,
});`}
            </pre>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Build in Public X Post Generator */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 border border-amber-500/30 px-3 py-1 text-xs font-semibold text-amber-300">
              <Flame className="h-3.5 w-3.5" />
              Build in public
            </div>
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-300">
              <img src="/logos/brands/x.svg" alt="X" className="h-3.5 w-3.5" />
              Tags @buildonbase
            </span>
          </div>

          <h2 className="text-xl font-bold text-white">Progress post generator</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            25% of the judging criteria is{" "}
            <strong>&quot;Build in public: dated progress posts and community growth&quot;</strong> . Write what you actually shipped today — the post adds live onchain numbers.
          </p>

          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Milestone templates (only post what you really shipped)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {[
                { dateLabel: "Day 1", day: 1, milestone: "Shipped live Chainlink NAV vs DEX price tracking for the 10 Coinbase tokenized stocks MAXXAGENT supports on Base" },
                { dateLabel: "Day 2", day: 2, milestone: "Hardened for the official rules: no synthetic data, US geo-block, non-custodial only" },
                { dateLabel: "Day 3", day: 3, milestone: "Shipped in-app basket buying: one wallet confirmation swaps USDC into each stock" },
                { dateLabel: "Day 4", day: 4, milestone: "Real price history: Chainlink rounds + DEX candles, replacing placeholder charts" },
                { dateLabel: "Day 5", day: 5, milestone: "Deployed StockMaxxIndexRegistry: publish an index onchain, anyone can buy it" },
                { dateLabel: "First buy", day: 6, milestone: "First real basket bought through MAXXAGENT on Base mainnet (tx in thread)" },
                { dateLabel: "Weekend", day: 7, milestone: "Weekend report: DEX vs Chainlink NAV gaps across the 10 supported tokenized stocks" },
                { dateLabel: "Users", day: 8, milestone: "Weekly numbers: wallets, baskets bought and volume attributed via Builder Code" },
              ].map((sched) => (
                <button
                  key={sched.day}
                  onClick={() => {
                    setDayNumber(sched.day);
                    setMilestoneTitle(sched.milestone);
                  }}
                  className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-mono transition cursor-pointer ${
                    dayNumber === sched.day
                      ? "border-[#4C6FFF] bg-[#4C6FFF]/20 text-white font-bold"
                      : "border-slate-800 bg-[#050811] text-slate-300 hover:border-slate-700 hover:text-white"
                  }`}
                >
                  {sched.dateLabel}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Build Day #
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={dayNumber}
                onChange={(e) => setDayNumber(Number(e.target.value) || 1)}
                className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 font-mono text-xs text-white"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Today&apos;s Shipped Milestone
              </label>
              <input
                type="text"
                value={milestoneTitle}
                onChange={(e) => setMilestoneTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 text-xs text-white"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Generated X Post (Live Onchain Telemetry Embedded):</span>
              <button
                onClick={() => copyToClipboard(buildInPublicPost, "x-post")}
                className="text-cyan-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <Copy className="h-3 w-3" />
                {copiedKey === "x-post" ? "Copied Post!" : "Copy Text"}
              </button>
            </div>
            <pre className="rounded-xl border border-slate-800 bg-[#050811] p-4 font-sans text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
              {buildInPublicPost}
            </pre>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href={`https://x.com/intent/tweet?text=${encodeURIComponent(buildInPublicPost)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-[#4C6FFF] px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-[#4C6FFF]/30 hover:bg-[#3D5BEA] transition"
            >
              <img src="/logos/brands/x.svg" alt="X" className="h-3.5 w-3.5" />
              Post Progress Update on X (@buildonbase)
            </a>
            <a
              href="https://docs.google.com/forms/d/1zotYvkeAtDjR2MKk3qNxyNIAfJ_IPQtzTtjNhOAF8js/viewform"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition"
            >
              <img src="/logos/partners/base.svg" alt="Base" className="h-4 w-4 rounded-xs" />
              Open Official Base Submission Form
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {/* Right: Official Submission Checklist & Loom Script */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-4">
            <div className="flex items-center gap-2">
              <img src="/logos/partners/base.svg" alt="Base" className="h-5 w-5 rounded-xs" />
              <h3 className="text-base font-bold text-white">
                Official Base Stocks Maxxing Submission Checklist
              </h3>
            </div>
            <ul className="space-y-2.5 text-xs text-slate-300">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Nov 5 – Nov 13, 2026:</strong> Apply via the form and join the partner
                  Telegram groups (office hours are announced in each partner brief).
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Configure Builder Code:</strong> Copy your Builder Code from{" "}
                  <code className="text-cyan-300">dashboard.base.org</code> into{" "}
                  <code className="text-emerald-300">.env.local</code> (
                  <code className="text-emerald-300">NEXT_PUBLIC_BASE_BUILDER_CODE</code>).
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Record a 2-minute video demo:</strong> live market data, the agent
                  proposal, a real basket purchase, and the Builder Code on BaseScan.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Before Dec 5, 2026 (11:59 PM UTC):</strong> Post Loom demo
                  publicly on X tagging <code className="text-blue-400">@buildonbase</code>{" "}
                  and submit the official form.
                </span>
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-3">
            <h3 className="text-sm font-bold text-white">2-minute demo script</h3>
            <ol className="list-decimal list-inside space-y-2 text-xs text-slate-300 leading-relaxed">
              <li>
                <strong>0:00–0:25 — Market:</strong> the 10 supported Coinbase tokenized stocks live on Base,
                Chainlink NAV (24/5) vs DEX price (24/7) on the real chart.
              </li>
              <li>
                <strong>0:25–0:55 — Agent:</strong> type a mandate, show the proposed weights, the
                live basket snapshot and the &quot;not financial advice&quot; framing.
              </li>
              <li>
                <strong>0:55–1:30 — Buy:</strong> buy a small basket with USDC in one wallet
                confirmation; show the stocks arriving in your own wallet.
              </li>
              <li>
                <strong>1:30–2:00 — Proof:</strong> open the tx on BaseScan and point to the ERC-8021
                suffix; show a published index in the registry.
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* Directory of Stocks Maxxing Season partners */}
      <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-4">
        <div>
          <h3 className="text-base font-bold text-white">
            Stocks Maxxing Season Partners & Support Channels
          </h3>
          <p className="text-xs text-slate-400">
            Partners of the Base Stocks Maxxing Season, listed for reference only. MAXXAGENT is
            an independent builder project and is not affiliated with, endorsed by, or
            sponsored by any of them. Prize details are set by each partner — see their brief.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STOCKS_MAXXING_PARTNERS.map((partner) => (
            <div
              key={partner.id}
              className="rounded-xl border border-slate-800 bg-[#070b14] p-4 flex flex-col justify-between gap-3"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <img
                    src={partner.logoUrl}
                    alt={partner.name}
                    className="h-9 w-9 rounded-lg border border-slate-800 bg-slate-900 p-1 object-contain"
                  />
                  <div>
                    <div className="text-sm font-bold text-white">{partner.name}</div>
                    <div className="font-mono text-[11px] text-cyan-400">{partner.handle}</div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">{partner.role}</p>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                <a
                  href={partner.notionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  Partner Brief <ExternalLink className="h-3 w-3" />
                </a>
                {partner.telegramUrl && (
                  <a
                    href={partner.telegramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-slate-300 hover:text-white underline"
                  >
                    Telegram Group
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
