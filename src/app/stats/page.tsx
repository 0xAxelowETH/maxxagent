"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { SiteNav } from "@/components/SiteNav";

interface Stats {
  ok: boolean;
  error?: string;
  builderCode: string;
  since: string;
  updatedAt: string;
  excludesTeamTestWallet: boolean;
  totals: { trades: number; buys: number; sells: number; volumeUsd: number; wallets: number; attributed: number };
  perStock: { symbol: string; trades: number; volumeUsd: number }[];
  indexBuys?: { id: number; buys: number; volumeUsd: number; wallets: number }[];
  daily: { date: string; trades: number; volumeUsd: number; wallets: number }[];
  recent: { time: string; wallet: string; side: "buy" | "sell"; symbol: string; usd: number; hash: string; attributed: boolean }[];
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function StatsPage() {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError("");
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d: Stats) => (d?.ok ? setData(d) : setError(d?.error || "Stats are unavailable right now.")))
      .catch(() => setError("Stats are unavailable right now."))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const t = data?.totals;
  return (
    <main className="min-h-screen bg-[#03060e] px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <SiteNav current="stats" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white">Live onchain stats</h1>
            <p className="text-sm text-slate-400">Every trade made through MAXXAGENT on Base, read directly from the chain.</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {error && <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">{error}</div>}

        {!data && !error && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-2xl border border-slate-800 bg-[#0b1120] animate-pulse" />
            ))}
            <p className="col-span-2 sm:col-span-4 text-xs text-slate-400">
              Reading every MAXXAGENT trade from Base… the first load can take up to 30 seconds.
            </p>
          </div>
        )}

        {data && t && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
              {[
                { label: "Trades", value: t.trades.toLocaleString("en-US"), sub: `${t.buys} buys · ${t.sells} sells` },
                { label: "Volume", value: usd(t.volumeUsd), sub: "USD value at trade time" },
                { label: "Unique wallets", value: t.wallets.toLocaleString("en-US"), sub: "distinct traders" },
                {
                  label: "Builder Code attributed",
                  value: t.trades ? `${Math.round((t.attributed / t.trades) * 100)}%` : "—",
                  sub: `${t.attributed}/${t.trades} · ${data.builderCode}`,
                },
              ].map((c) => (
                <div key={c.label} className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4">
                  <div className="font-sans text-[11px] text-slate-400">{c.label}</div>
                  <div className="text-xl font-extrabold text-white">{c.value}</div>
                  <div className="font-sans text-[10px] text-slate-500">{c.sub}</div>
                </div>
              ))}
            </div>

            {t.trades === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-400">
                No trades from users yet.{" "}
                <Link href="/" className="text-cyan-300 underline">
                  Be the first
                </Link>
                .
              </div>
            ) : (
              <>
                <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 space-y-3">
                  <h2 className="text-sm font-bold text-white">By stock</h2>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                        <th className="py-2">Stock</th>
                        <th className="py-2 text-right">Trades</th>
                        <th className="py-2 text-right">Volume</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {data.perStock.map((s) => (
                        <tr key={s.symbol} className="border-b border-slate-800/60">
                          <td className="py-2 font-sans font-semibold text-white">{s.symbol}</td>
                          <td className="py-2 text-right text-slate-300">{s.trades}</td>
                          <td className="py-2 text-right text-white">{usd(s.volumeUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                {(data.indexBuys?.length ?? 0) > 0 && (
                  <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 space-y-3">
                    <h2 className="text-sm font-bold text-white">Index buys</h2>
                    <p className="text-[11px] text-slate-400">
                      A wallet buying exactly an index&apos;s stocks, in its weights, within a few minutes.
                    </p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                          <th className="py-2">Index</th>
                          <th className="py-2 text-right">Buys</th>
                          <th className="py-2 text-right">Wallets</th>
                          <th className="py-2 text-right">Volume</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {data.indexBuys!.map((x) => (
                          <tr key={x.id} className="border-b border-slate-800/60">
                            <td className="py-2">
                              <Link href={`/index/${x.id}`} className="text-cyan-300 underline">
                                #{x.id}
                              </Link>
                            </td>
                            <td className="py-2 text-right">{x.buys}</td>
                            <td className="py-2 text-right">{x.wallets}</td>
                            <td className="py-2 text-right">{usd(x.volumeUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}
                <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 space-y-3">
                  <h2 className="text-sm font-bold text-white">By day (UTC)</h2>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                        <th className="py-2">Date</th>
                        <th className="py-2 text-right">Trades</th>
                        <th className="py-2 text-right">Wallets</th>
                        <th className="py-2 text-right">Volume</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {data.daily.map((d) => (
                        <tr key={d.date} className="border-b border-slate-800/60">
                          <td className="py-2 text-slate-200">{d.date}</td>
                          <td className="py-2 text-right text-slate-300">{d.trades}</td>
                          <td className="py-2 text-right text-slate-300">{d.wallets}</td>
                          <td className="py-2 text-right text-white">{usd(d.volumeUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 space-y-3">
                  <h2 className="text-sm font-bold text-white">Recent trades</h2>
                  <div className="divide-y divide-slate-800/70">
                    {data.recent.map((r) => (
                      <a
                        key={r.hash}
                        href={`https://basescan.org/tx/${r.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-3 py-2 text-xs hover:bg-slate-800/40 rounded-lg px-1"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${r.side === "buy" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                            {r.side}
                          </span>
                          <span className="font-semibold text-white">{r.symbol}</span>
                          <span className="font-mono text-slate-500 truncate">{r.wallet}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0 font-mono">
                          <span className="text-white">{usd(r.usd)}</span>
                          <span className="text-slate-500 hidden sm:inline">{new Date(r.time).toISOString().slice(5, 16).replace("T", " ")}</span>
                          <span title={r.attributed ? "Builder Code attached" : "No Builder Code"} className={r.attributed ? "text-emerald-300" : "text-slate-500"}>
                            {r.attributed ? "✓" : "·"}
                          </span>
                          <ExternalLink className="h-3 w-3 text-slate-500" />
                        </span>
                      </a>
                    ))}
                  </div>
                </section>
              </>
            )}

            <p className="text-[11px] leading-relaxed text-slate-500">
              How this is computed: every swap MAXXAGENT builds goes through the KyberSwap router with source{" "}
              <code className="text-slate-300">maxxagent</code>, which the router records onchain (ClientData event, including the
              USD value). The router&apos;s Swapped event gives the wallet and the stock; the transaction data shows whether the Base
              Builder Code <code className="text-slate-300">{data.builderCode}</code> is attached.
              {data.excludesTeamTestWallet ? " The team's own test wallet is excluded." : ""} Since{" "}
              {new Date(data.since).toISOString().slice(0, 10)} · updated {new Date(data.updatedAt).toISOString().slice(11, 16)} UTC.{" "}
              <a href="/verify" className="text-cyan-300 underline">
                Check it yourself
              </a>
              .
            </p>
          </>
        )}
      </div>
    </main>
  );
}
