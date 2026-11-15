import { ExternalLink } from "lucide-react";
import { navDailyCloses } from "@/lib/riskStats";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import type { PublishedIndex } from "@/lib/indexRegistry";

/**
 * Fund-factsheet view of a published index (server component): key facts, sector mix, the weighted change of the
 * constituents' Chainlink NAV since publication (clearly hypothetical), data sources and the main risks.
 * Uses only the onchain index, the static stock list and the shared daily NAV cache.
 */
const SECTOR_COLOR: Record<string, string> = {
  "AI & Semiconductors": "#38bdf8",
  "Big Tech Cloud": "#6366f1",
  "Frontier & Crypto": "#f59e0b",
  "Consumer & Hardware": "#34d399",
};

async function sincePublished(ix: PublishedIndex): Promise<{ pct: number; from: string } | null> {
  try {
    const meta = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s]));
    let total = 0;
    let fromDay = "";
    for (const c of ix.constituents) {
      const feed = meta.get(c.symbol)?.chainlinkFeed;
      if (!feed) return null;
      const closes = await navDailyCloses(feed);
      // The first daily close at or after publication, and the latest one
      const start = closes.find(([t]) => t >= ix.createdAt);
      const last = closes[closes.length - 1];
      if (!start || !last || last[0] <= start[0]) return null;
      total += (c.weightBps / 10_000) * (last[1] / start[1] - 1);
      fromDay = new Date(start[0] * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    }
    return { pct: total * 100, from: fromDay };
  } catch {
    return null;
  }
}

export async function IndexFactsheet({ ix }: { ix: PublishedIndex }) {
  const meta = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s]));
  const sorted = [...ix.constituents].sort((a, b) => b.weightBps - a.weightBps);
  const top3 = sorted.slice(0, 3).reduce((a, c) => a + c.weightBps, 0) / 100;
  const sectors = new Map<string, number>();
  for (const c of ix.constituents) {
    const s = meta.get(c.symbol)?.sector ?? "Other";
    sectors.set(s, (sectors.get(s) ?? 0) + c.weightBps / 100);
  }
  const perf = await sincePublished(ix);
  const date = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const facts: [string, string][] = [
    ["Holdings", `${ix.constituents.length} tokenized stocks`],
    ["Largest weight", `${sorted[0].symbol} ${(sorted[0].weightBps / 100).toFixed(1)}%`],
    ["Top 3 together", `${top3.toFixed(1)}%`],
    ["Published", date(ix.createdAt)],
    ["Last change", ix.version > 1 ? `${date(ix.updatedAt)} (version ${ix.version})` : "Never changed (version 1)"],
    ["Network", "Base mainnet"],
    ["Index fee", "None (the registry takes no fees)"],
    ["Custody", "None: you hold the stocks in your own wallet"],
  ];

  return (
    <div className="space-y-4" data-testid="index-factsheet">
      <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4">
        <h2 className="text-sm font-bold text-white">Key facts</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-slate-800/70 pb-1.5">
              <dt className="text-slate-400">{k}</dt>
              <dd className="text-right font-semibold text-slate-100">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 space-y-3">
        <h2 className="text-sm font-bold text-white">Sector mix</h2>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
          {[...sectors].map(([s, w]) => (
            <div key={s} style={{ width: `${w}%`, background: SECTOR_COLOR[s] ?? "#64748b" }} title={`${s} ${w.toFixed(1)}%`} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300">
          {[...sectors].map(([s, w]) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: SECTOR_COLOR[s] ?? "#64748b" }} />
              {s} {w.toFixed(1)}%
            </span>
          ))}
        </div>
      </section>

      {perf && (
        <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4" data-testid="index-since">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-white">Change since published</h2>
            <span className={`font-mono text-xl font-bold ${perf.pct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
              {perf.pct >= 0 ? "+" : ""}
              {perf.pct.toFixed(2)}%
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            Hypothetical: the weighted change of the constituents&apos; Chainlink NAV from the first close after publication ({perf.from})
            to the latest close. Not a return anyone earned (swap costs and timing differ), and past changes don&apos;t predict future
            ones.
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 space-y-2">
        <h2 className="text-sm font-bold text-white">Data sources</h2>
        <ul className="space-y-1.5 text-[11px] text-slate-300">
          {ix.constituents.map((c) => {
            const m = meta.get(c.symbol);
            if (!m) return null;
            return (
              <li key={c.symbol} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="w-16 font-mono font-bold text-white">{c.symbol}</span>
                <a href={`https://basescan.org/address/${m.chainlinkFeed}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-cyan-300 hover:underline">
                  Chainlink NAV feed <ExternalLink className="h-2.5 w-2.5" />
                </a>
                <a href={m.basescanUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-cyan-300 hover:underline">
                  Token contract <ExternalLink className="h-2.5 w-2.5" />
                </a>
                <a href={m.prospectusUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-cyan-300 hover:underline">
                  Coinbase prospectus <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-1.5">
        <h2 className="text-sm font-bold text-white">Main risks</h2>
        <ul className="list-disc space-y-1 pl-4 text-[11px] text-slate-300">
          <li>Tokenized stocks track the shares but are not the shares: no voting rights, and they depend on Coinbase as issuer.</li>
          <li>The DEX price trades 24/7 and can move away from the NAV while the US market is closed.</li>
          <li>
            Concentration: the top 3 holdings are {top3.toFixed(0)}% of the index{sectors.size === 1 ? ", all in one sector" : ""}.
          </li>
          <li>Liquidity on Base pools varies; large orders cost more. Every order shows its cost before you sign.</li>
        </ul>
      </section>
    </div>
  );
}
