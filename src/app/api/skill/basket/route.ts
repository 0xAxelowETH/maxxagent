import { NextRequest, NextResponse } from "next/server";
import { POST as runAgent } from "@/app/api/agent/route";
import type { AgentAnalysisReport } from "@/lib/agentEngine";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { cleanIndexName } from "@/lib/shareBasket";
import { MIN_BUY_USD } from "@/lib/tokenizedStocks";

/**
 * Read-only basket proposals for other agents (the MAXXAGENT Baskets skill in the Bankr skills catalog).
 *
 *   GET /api/skill/basket?prompt=AI and cloud, no Tesla, max 30% each&risk=Balanced&amount=200
 *   GET /api/skill/basket?prompt=…&then=replace Microsoft with Apple&then=drop Meta   (follow-ups, in order)
 *
 * `amount` (USD) is optional; without it the first "$200" in the request is used. With an amount, `buyUrl`
 * opens the basket with that amount filled in (minus the USDC the user keeps).
 *
 * Runs the same rule-based engine as the Agent tab and returns the basket, the cash kept in USDC, how the
 * request was read, the limits and what was done with them, the stocks left out and why, and checkable facts
 * with their sources. It never trades: `buyUrl` opens the basket on maxxagent.xyz, where the person reviews
 * it and buys from their own wallet (eligible non-US persons only). Not financial advice.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, "");
const META = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s]));
const RISKS = ["Conservative", "Balanced", "Aggressive"] as const;
const NOTICE =
  "Proposal only, not financial advice. Coinbase tokenized stocks on Base are only for eligible persons outside the U.S. MAXXAGENT never holds funds: the person reviews the basket and signs every trade from their own wallet.";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const prompt = cleanIndexName(q.get("prompt"), 500);
  if (!prompt) {
    return NextResponse.json(
      { ok: false, error: "Add ?prompt= with what the basket should be, e.g. \"AI and cloud, no Tesla, max 30% each, keep 10% in cash\"." },
      { status: 400 }
    );
  }
  const riskParam = (q.get("risk") || "Balanced").toLowerCase();
  const riskProfile = RISKS.find((r) => r.toLowerCase() === riskParam) ?? "Balanced";
  // Follow-ups refine the same basket step by step, like "Refine this basket" on the site
  const followUps = q.getAll("then").map((t) => cleanIndexName(t, 300)).filter(Boolean).slice(0, 5);
  const promptSteps = followUps.length ? [prompt, ...followUps] : undefined;
  // Amount: ?amount=, else the first dollar figure in the request ("split $200 across…")
  const rawAmount = q.get("amount") ?? [prompt, ...followUps].join(" ").match(/\$\s?(\d[\d,]*(?:\.\d+)?)/)?.[1]?.replace(/,/g, "");
  const amountNum = Number(rawAmount);
  const amountUsd = Number.isFinite(amountNum) && amountNum >= MIN_BUY_USD && amountNum <= 100_000 ? Math.round(amountNum * 100) / 100 : undefined;

  const res = await runAgent(
    new NextRequest(new URL("/api/agent", request.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userPrompt: prompt, promptSteps, riskProfile, ...(amountUsd ? { capitalUsd: amountUsd } : {}) }),
    })
  ).catch(() => null);
  const j = res ? ((await res.json().catch(() => null)) as { ok?: boolean; report?: AgentAnalysisReport; error?: string } | null) : null;
  if (!j?.ok || !j.report) {
    return NextResponse.json({ ok: false, error: j?.error || "The agent could not build a basket right now. Please retry in a minute." }, { status: 503 });
  }
  const r = j.report;

  const basket = r.allocations
    .filter((a) => a.capitalSharePct > 0 && META.has(a.symbol))
    .sort((a, b) => b.capitalSharePct - a.capitalSharePct)
    .map((a) => ({
      symbol: a.symbol,
      company: META.get(a.symbol)!.companyName,
      sharePct: Number(a.capitalSharePct.toFixed(2)),
      why: a.reasons.slice(0, 3),
      stockPage: `${SITE}/stock/${a.symbol}`,
    }));
  // The site's basket link carries stock weights only; the USDC part is kept by buying for less
  const stocksTotal = basket.reduce((s, b) => s + b.sharePct, 0);
  const basketParam = basket.map((b) => `${b.symbol}-${Number(((b.sharePct / stocksTotal) * 100).toFixed(2))}`).join(",");
  // With an amount, the link fills in what goes into stocks; the USDC part simply stays in the wallet
  const stocksAmount = amountUsd ? Math.round(amountUsd * (stocksTotal / 100) * 100) / 100 : undefined;
  const linkAmount = stocksAmount && stocksAmount >= MIN_BUY_USD ? stocksAmount : undefined;
  const buyUrl = basket.length
    ? `${SITE}/?${new URLSearchParams({ basket: basketParam, name: "Agent basket", ...(linkAmount ? { amount: String(linkAmount) } : {}), utm_source: "bankr-skill" })}`
    : null;
  const cashPct = r.cashReservePct;
  const buyNote = !buyUrl
    ? undefined
    : linkAmount && amountUsd
    ? `The link buys $${linkAmount.toFixed(2)} of stocks${cashPct > 0.05 ? ` and keeps $${(amountUsd - linkAmount).toFixed(2)} (${cashPct.toFixed(0)}%) in USDC` : ""}, out of $${amountUsd.toFixed(2)}.`
    : cashPct > 0.05
    ? `The link holds the stock weights; to keep ${cashPct.toFixed(0)}% in USDC, buy for that much less than the total amount.`
    : undefined;
  // When live volatility history hasn't loaded yet, the agent falls back to fixed estimates for this run
  const riskNote = r.assumptions.find((a) => /risk history/i.test(a));
  // Any part of the request the basket couldn't follow (an unsupported stock, a substitute theme, a cash share
  // above 90%…): the calling agent must explain it and get new instructions before offering the buy link
  const notPossible = r.limits.filter((l) => l.status === "not possible");
  const confirmationReasons = notPossible.map((l) => `${l.label}: ${l.detail}`);
  if (!basket.length) confirmationReasons.push("No stock could be picked for this request.");
  const needsConfirmation = confirmationReasons.length > 0;

  return NextResponse.json(
    {
      ok: true,
      prompt,
      followUps,
      amountUsd: amountUsd ?? null,
      riskProfile: r.riskProfile,
      basket,
      cashKeptInUsdcPct: Number(r.cashReservePct.toFixed(2)),
      howTheRequestWasRead: r.interpretation,
      limits: r.limits.map((l) => ({ label: l.label, status: l.status, detail: l.detail })),
      leftOut: (r.leftOut ?? []).map((l) => ({ symbol: l.symbol, reason: l.reason })),
      facts: r.facts.map((f) => ({ symbol: f.symbol, text: f.text, sources: f.links.map((l) => l.url) })),
      assumptions: r.assumptions,
      cautions: r.cautions ?? [],
      needsConfirmation,
      confirmationReasons,
      buyUrl,
      buyNote,
      riskNote,
      notice: NOTICE,
      generatedAt: r.timestamp,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
