"use client";

import { useEffect, useState } from "react";
import { MaxxLoader } from "@/components/MaxxLoader";
import { Ban, CheckCircle2, Hand, Loader2, Receipt } from "lucide-react";
import type { AgentAnalysisReport } from "@/lib/agentEngine";

/**
 * "Watch it think": the steps the rule-based agent went through for this request, revealed one by one, each with
 * receipts (links to the sources it read). And "What I won't do": every limit it refused or had to change, with the
 * reason. Everything comes from the report itself; nothing here is invented or extra research.
 */
interface Step {
  title: string;
  detail: string;
  receipts: { label: string; url: string }[];
}

const pick = (re: RegExp, s: string) => s.match(re)?.[1];

function stepsOf(r: AgentAnalysisReport): Step[] {
  const receipts = (label: RegExp) =>
    r.facts.flatMap((f) => f.links.filter((l) => label.test(l.label)).map((l) => ({ label: f.symbol, url: l.url })));
  const navs = r.facts
    .map((f) => {
      const nav = pick(/NAV \$([\d,.]+)/, f.text);
      return nav ? `${f.symbol} $${nav}` : null;
    })
    .filter(Boolean);
  const sec = r.facts
    .map((f) => {
      const rev = pick(/revenue (\$[\d.,]+[BMK]?)/, f.text);
      const growth = pick(/\(([+-]\d+%) vs the year before\)/, f.text);
      return rev ? `${f.symbol} revenue ${rev}${growth ? ` (${growth})` : ""}` : null;
    })
    .filter(Boolean);
  const pools = r.facts
    .map((f) => {
      const liq = pick(/pool liquidity (\$[\d.,]+[BMK]?)/, f.text);
      return liq ? `${f.symbol} ${liq}` : null;
    })
    .filter(Boolean);
  const notPossible = r.limits.filter((l) => l.status === "not possible").length;
  const kept = r.limits.filter((l) => l.status === "kept").length;
  const adjusted = r.limits.filter((l) => l.status === "adjusted").length;
  return [
    { title: "Read your request", detail: r.interpretation.join(" · ") || "No specific request: a balanced basket.", receipts: [] },
    {
      title: "Checked what can be bought",
      detail: `The 10 Coinbase tokenized stocks MAXXAGENT supports on Base${notPossible ? `; ${notPossible} thing${notPossible > 1 ? "s" : ""} you asked for can't be done (see below)` : ""}${
        r.leftOut?.length ? `; ${r.leftOut.length} supported stocks left out, each with a reason` : ""
      }.`,
      receipts: [],
    },
    { title: "Read live prices (Chainlink NAV)", detail: navs.join(" · ") || "NAV unavailable for these picks.", receipts: receipts(/chainlink/i) },
    {
      title: "Read company filings (SEC 10-K)",
      detail: sec.join(" · ") || "No annual report figures for these picks.",
      receipts: receipts(/10-K|SEC/i),
    },
    { title: "Checked liquidity (Base DEX pools)", detail: pools.join(" · ") || "Pool depth unavailable.", receipts: receipts(/DEX pool|pool/i) },
    {
      title: "Applied your limits",
      detail: r.limits.length ? `${kept} kept${adjusted ? `, ${adjusted} adjusted` : ""}${notPossible ? `, ${notPossible} not possible` : ""}.` : "No limits given.",
      receipts: [],
    },
    {
      title: "Proposed a basket",
      detail: `${r.allocations.map((a) => `${a.symbol} ${a.capitalSharePct.toFixed(1)}%`).join(" · ")}${r.cashReservePct ? ` · cash ${r.cashReservePct}%` : ""}. You review and sign every order.`,
      receipts: [],
    },
  ];
}

export function AgentTrace({ report, running }: { report: AgentAnalysisReport | null; running: boolean }) {
  const steps = report ? stepsOf(report) : [];
  const [shown, setShown] = useState(0);
  const [tick, setTick] = useState(0);

  // Reveal the steps of a new report one after another
  useEffect(() => {
    if (!report) return;
    setShown(0);
    const id = setInterval(() => setShown((n) => (n >= 7 ? (clearInterval(id), n) : n + 1)), 260);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.timestamp]);
  // While the agent runs, walk a spinner down the step names
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 450);
    return () => clearInterval(id);
  }, [running]);

  const names = ["Read your request", "Checked what can be bought", "Read live prices (Chainlink NAV)", "Read company filings (SEC 10-K)", "Checked liquidity (Base DEX pools)", "Applied your limits", "Proposed a basket"];
  const refusals = report?.limits.filter((l) => l.status !== "kept") ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-cyan-500/25 bg-[#0b1120] p-4 sm:p-5" data-testid="agent-trace" aria-label="How the agent worked">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-white">Watch it think</h3>
          {running && <MaxxLoader size={22} label="Researching…" />}
        </div>
        <p className="text-[11px] text-slate-400">Every step it took for your request, with receipts: open them to check the source yourself.</p>
        <ol className="mt-3 space-y-2.5">
          {names.map((name, i) => {
            const step = steps[i];
            const done = !running && report && i < shown;
            const active = running && i === tick % names.length;
            return (
              <li key={name} className={`flex gap-3 transition-opacity duration-300 ${done || active ? "opacity-100" : "opacity-40"}`}>
                <span className="mt-0.5 shrink-0">
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : active ? (
                    <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
                  ) : (
                    <span className="block h-4 w-4 rounded-full border border-slate-600" />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-100">{name}</div>
                  {done && step && (
                    <>
                      <div className="text-[11px] leading-relaxed text-slate-400">{step.detail}</div>
                      {step.receipts.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {step.receipts.map((rc) => (
                            <a
                              key={rc.url}
                              href={rc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 font-mono text-[10px] text-cyan-200 hover:border-cyan-400 hover:text-white"
                            >
                              <Receipt className="h-2.5 w-2.5" />
                              {rc.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {refusals.length > 0 && !running && (
        <section className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 sm:p-5" data-testid="agent-refusals" aria-label="What the agent won't do">
          <h3 className="text-sm font-bold text-white">What I won&apos;t do, and why</h3>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {refusals.map((l) => (
              <div key={l.label} className={`rounded-xl border p-3 ${l.status === "not possible" ? "border-rose-500/40 bg-[#14070c]" : "border-amber-500/40 bg-[#141006]"}`}>
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  {l.status === "not possible" ? <Ban className="h-4 w-4 text-rose-300" /> : <Hand className="h-4 w-4 text-amber-300" />}
                  {l.status === "not possible" ? `Won't do: ${l.label}` : `Changed: ${l.label}`}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{l.detail}</p>
                {l.link && (
                  <a href={l.link.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[11px] text-cyan-300 underline hover:text-white">
                    {l.link.label}
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
