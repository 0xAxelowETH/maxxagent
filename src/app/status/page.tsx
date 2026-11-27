import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleX, ExternalLink } from "lucide-react";
import { SiteNav } from "@/components/SiteNav";
import { StatusRefresh } from "@/components/StatusRefresh";
import { GET as healthGET } from "@/app/api/health/route";
import type { B20StockStatus } from "@/lib/b20Guard";

/**
 * Human-readable view of /api/health: every data source MAXXAGENT depends on, and the B20 transfer rules of
 * the 10 stocks, with what each one is for and what breaks if it's down. The JSON endpoint stays as it is
 * (monitors and the GitHub workflow read it).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "System status — MAXXAGENT",
  description:
    "Live status of everything MAXXAGENT depends on: the Base network, Chainlink price feeds, KyberSwap routing, DEX data, and the B20 transfer rules of the 10 tokenized stocks.",
  alternates: { canonical: "/status" },
  openGraph: { url: "/status" },
};

type Check = { ok: boolean; ms: number; detail?: string; critical: boolean; block?: string; oracleAgeMinutes?: number; policies?: Record<string, string>; stocks?: B20StockStatus[] };
type Health = { ok: boolean; checkedAt: string; checks: Record<string, Check> };

const SOURCES: { key: string; name: string; what: string; impact: string; extra?: (c: Check) => string | null }[] = [
  {
    key: "baseRpc",
    name: "Base network (RPC)",
    what: "Reads balances, prices and contracts on Base mainnet.",
    impact: "Nothing onchain can be read: wallets, prices and trades stop.",
    extra: (c) => (c.block ? `Latest block #${Number(c.block).toLocaleString("en-US")}` : null),
  },
  {
    key: "chainlink",
    name: "Chainlink price feeds",
    what: "The official NAV of each stock token, the price of record.",
    impact: "Prices and the agent's NAV checks can't be trusted; buys are refused.",
    extra: (c) =>
      typeof c.oracleAgeMinutes === "number"
        ? `Last update ${c.oracleAgeMinutes < 60 ? `${c.oracleAgeMinutes} min` : `${Math.round(c.oracleAgeMinutes / 60)} h`} ago${c.oracleAgeMinutes > 60 ? " (feeds pause outside US market hours)" : ""}`
        : null,
  },
  {
    key: "kyberswap",
    name: "KyberSwap routing",
    what: "Finds the best route for every buy and sell, across Base pools.",
    impact: "Buying and selling stop until routing is back.",
  },
  {
    key: "b20Transfers",
    name: "B20 transfer rules",
    what: "Coinbase's transfer policies on all 10 stocks still let wallets, the router and the pools move them.",
    impact: "Swaps of the affected stock would revert onchain (no funds lost, only gas).",
    extra: (c) => (c.stocks ? `${c.stocks.filter((s) => s.ok).length} / ${c.stocks.length} stocks clear` : null),
  },
  {
    key: "dexscreener",
    name: "DexScreener",
    what: "24/7 DEX prices, pool liquidity and the Paired tab.",
    impact: "Some DEX figures and the Paired tab show less; trading still works.",
  },
  {
    key: "geckoterminal",
    name: "GeckoTerminal",
    what: "Price history for charts and the agent's checks.",
    impact: "Some charts can't load; trading still works.",
  },
];

type Run = { created_at: string; event: string; conclusion: string | null; status: string; html_url: string };
async function recentRuns(): Promise<Run[] | null> {
  try {
    const res = await fetch("https://api.github.com/repos/0xAxelowETH/maxxagent/actions/workflows/health.yml/runs?per_page=5", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "maxxagent-status" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { workflow_runs?: Run[] };
    return j.workflow_runs ?? null;
  } catch {
    return null;
  }
}

const Pill = ({ ok, okText = "Operational", badText = "Down" }: { ok: boolean; okText?: string; badText?: string }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
      ok ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/10 text-rose-300 border border-rose-500/30"
    }`}
  >
    {ok ? <CheckCircle2 className="h-3 w-3" /> : <CircleX className="h-3 w-3" />}
    {ok ? okText : badText}
  </span>
);
const Yes = ({ v }: { v?: boolean }) =>
  v === undefined ? <span className="text-slate-500">—</span> : v ? <span className="text-emerald-300">✓ allowed</span> : <span className="font-bold text-rose-300">✕ blocked</span>;

export default async function StatusPage() {
  const [res, runs] = await Promise.all([healthGET(), recentRuns()]);
  const health = (await res.json()) as Health;
  const checks = health.checks;
  const criticalDown = SOURCES.filter((s) => checks[s.key]?.critical && !checks[s.key]?.ok);
  const optionalDown = SOURCES.filter((s) => checks[s.key] && !checks[s.key].critical && !checks[s.key].ok);
  const b20 = checks.b20Transfers;
  const overall = criticalDown.length
    ? { tone: "rose", icon: CircleX, title: "Trading may be affected", text: `${criticalDown.map((s) => s.name).join(", ")} ${criticalDown.length > 1 ? "are" : "is"} down. Buying and selling can fail until it's back; your funds stay in your wallet.` }
    : optionalDown.length
    ? { tone: "amber", icon: AlertTriangle, title: "Partly degraded", text: `${optionalDown.map((s) => s.name).join(", ")} ${optionalDown.length > 1 ? "are" : "is"} slow or down. Trading works; some charts or tabs show less.` }
    : { tone: "emerald", icon: CheckCircle2, title: "All systems operational", text: "Every data source answered, and all 10 stocks can be swapped." };
  const OverallIcon = overall.icon;
  const toneBox = { rose: "border-rose-500/40 bg-rose-500/10", amber: "border-amber-500/40 bg-amber-500/10", emerald: "border-emerald-500/40 bg-emerald-500/10" }[overall.tone];
  const toneText = { rose: "text-rose-300", amber: "text-amber-300", emerald: "text-emerald-300" }[overall.tone];

  return (
    <main className="min-h-screen bg-[#02050c] bg-cyber-grid px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <SiteNav current="status" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white">System status</h1>
            <p className="text-sm text-slate-400">Live checks of everything MAXXAGENT depends on, run on the server.</p>
          </div>
          <StatusRefresh checkedAt={health.checkedAt} />
        </div>

        <section className={`flex items-start gap-4 rounded-2xl border p-5 ${toneBox}`}>
          <OverallIcon className={`mt-0.5 h-7 w-7 shrink-0 ${toneText}`} />
          <div>
            <h2 className={`text-lg font-extrabold ${toneText}`}>{overall.title}</h2>
            <p className="mt-1 text-sm text-slate-300">{overall.text}</p>
            <p className="mt-2 font-mono text-[11px] text-slate-500">Checked {new Date(health.checkedAt).toUTCString().replace(" GMT", " UTC")}</p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-extrabold text-white">Data sources</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {SOURCES.map((s) => {
              const c = checks[s.key];
              if (!c) return null;
              const extra = s.extra?.(c);
              return (
                <div key={s.key} className={`rounded-2xl border bg-[#0b1120] p-4 ${c.ok ? "border-slate-800" : "border-rose-500/40"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-white">{s.name}</h3>
                      <p className="mt-0.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">{c.critical ? "Needed for trading" : "Optional"}</p>
                    </div>
                    <Pill ok={c.ok} />
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">{s.what}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-slate-400">
                    <span>{c.ms} ms</span>
                    {extra && <span>{extra}</span>}
                  </div>
                  {!c.ok && (
                    <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 text-[11px] text-rose-200">
                      <b>If down:</b> {s.impact}
                      {c.detail ? <span className="block mt-1 font-mono text-rose-300/80">{c.detail}</span> : null}
                    </p>
                  )}
                  {c.ok && <p className="mt-2 text-[11px] text-slate-500">If down: {s.impact}</p>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-white">B20 transfer rules · 10 stocks</h2>
            <Pill ok={!!b20?.ok} okText="All clear" badText="Problem" />
          </div>
          <p className="text-xs leading-relaxed text-slate-300">
            Coinbase&apos;s stock tokens are B20 tokens. Each carries transfer policies for the <b>sender</b>, the <b>receiver</b>{" "}
            and the <b>executor</b> (whoever moves the tokens, e.g. a swap router), set by the issuer and enforced by Base. Since the
            Denim upgrade an issuer can allow only approved executors. We read the rules onchain and check that ordinary wallets, the
            KyberSwap router and the Uniswap v4 pools can still move each stock. Policy #5 today is a blocklist: everyone is allowed
            unless the issuer blocks them.
          </p>
          {b20?.stocks?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                  <tr className="border-b border-slate-800">
                    <th className="py-2 pr-3">Stock</th>
                    <th className="py-2 pr-3">Policies (sender · receiver · executor)</th>
                    <th className="py-2 pr-3">Transfers</th>
                    <th className="py-2 pr-3">Wallets</th>
                    <th className="py-2 pr-3">KyberSwap</th>
                    <th className="py-2 pr-3">Uniswap v4</th>
                  </tr>
                </thead>
                <tbody>
                  {b20.stocks.map((s) => (
                    <tr key={s.symbol} className={`border-b border-slate-800/60 ${s.ok ? "" : "bg-rose-500/5"}`}>
                      <td className="py-2 pr-3">
                        <Link href={`/stock/${s.symbol}`} className="font-bold text-white hover:text-cyan-300">
                          {s.symbol}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 font-mono text-slate-300">{s.read ? `#${s.sender} · #${s.receiver} · #${s.executor}` : "couldn't read"}</td>
                      <td className="py-2 pr-3">{s.transfersPaused === undefined ? "—" : s.transfersPaused ? <span className="font-bold text-rose-300">paused</span> : <span className="text-emerald-300">open</span>}</td>
                      <td className="py-2 pr-3"><Yes v={s.ordinaryAllowed} /></td>
                      <td className="py-2 pr-3"><Yes v={s.routerAllowed} /></td>
                      <td className="py-2 pr-3"><Yes v={s.poolManagerAllowed} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-rose-300">The rules couldn&apos;t be read right now{b20?.detail ? `: ${b20.detail}` : "."}</p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-5 space-y-3 text-xs text-slate-300">
          <h2 className="text-base font-extrabold text-white">How it&apos;s monitored</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>This page runs the checks live each time it loads (and every minute while open).</li>
            <li>
              A GitHub Actions workflow calls the same checks every few hours. If they keep failing, the team gets an email, with
              the stock and the reason named.
            </li>
            <li>Nothing here can move funds: every trade is still reviewed and signed in your own wallet.</li>
          </ul>
          {runs?.length ? (
            <div>
              <p className="mb-1.5 font-semibold text-slate-200">Recent scheduled checks</p>
              <ul className="space-y-1 font-mono text-[11px]">
                {runs.map((r) => (
                  <li key={r.html_url} className="flex flex-wrap items-center gap-x-3">
                    <span className={r.conclusion === "success" ? "text-emerald-300" : r.status !== "completed" ? "text-amber-300" : "text-rose-300"}>
                      {r.conclusion === "success" ? "✓ passed" : r.status !== "completed" ? "… running" : `✕ ${r.conclusion}`}
                    </span>
                    <span className="text-slate-400">{new Date(r.created_at).toUTCString().replace(" GMT", " UTC")}</span>
                    <span className="text-slate-500">{r.event === "schedule" ? "scheduled" : "manual"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            <a href="/api/health" className="inline-flex items-center gap-1 text-cyan-300 underline">
              Raw JSON (/api/health) <ExternalLink className="h-3 w-3" />
            </a>
            <a href="https://github.com/0xAxelowETH/maxxagent/blob/main/src/lib/b20Guard.ts" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300 underline">
              B20 check source <ExternalLink className="h-3 w-3" />
            </a>
            <a href="https://github.com/0xAxelowETH/maxxagent/actions/workflows/health.yml" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300 underline">
              Workflow runs <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
