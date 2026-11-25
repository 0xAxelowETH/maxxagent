import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { POST as runAgent } from "@/app/api/agent/route";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { cleanIndexName } from "@/lib/shareBasket";
import type { AgentAnalysisReport } from "@/lib/agentEngine";
import { Brand, Chip, Footer, Frame, MUTED, ogLogos, ogMark, ogOptions, ogOrigin } from "@/lib/og/kit";

/**
 * Share card for an agent link (/?tab=agent&prompt=…): /api/og/agent?prompt=…
 * The request in a chat bubble, then the basket the agent builds for it. The agent runs in-process
 * with the same engine and defaults as the page, so the card matches what the visitor sees
 * (live prices can move the shares a little). If it doesn't answer in time, only the request is shown.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const META = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s]));
const USDC_BLUE = "#2775ca";
// Crawlers give up after a few seconds: past this the card shows the request without the basket
const AGENT_TIMEOUT_MS = 3000;

async function proposal(origin: string, prompt: string): Promise<AgentAnalysisReport | null> {
  const req = new NextRequest(new URL("/api/agent", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userPrompt: prompt, riskProfile: "Balanced" }),
  });
  const run = runAgent(req)
    .then(async (r) => (r.ok ? ((await r.json()) as { ok: boolean; report?: AgentAnalysisReport }) : null))
    .then((j) => (j?.ok && j.report ? j.report : null))
    .catch(() => null);
  return Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), AGENT_TIMEOUT_MS))]);
}

export async function GET(req: Request) {
  const origin = ogOrigin(req);
  const prompt = cleanIndexName(new URL(req.url).searchParams.get("prompt"), 160) || "AI and cloud, anything but Tesla, cap each at 30%, keep 10% in cash";
  const [mark, report, logos] = await Promise.all([ogMark(), proposal(origin, prompt), ogLogos(BASE_TOKENIZED_STOCKS)]);

  const legs = (report?.allocations ?? [])
    .filter((a) => a.capitalSharePct > 0 && META.has(a.symbol))
    .sort((a, b) => b.capitalSharePct - a.capitalSharePct)
    .map((a) => ({ symbol: a.symbol, pct: a.capitalSharePct, color: META.get(a.symbol)!.color || "#4C6FFF", logo: logos.get(a.symbol) || "" }));
  const cash = report && report.cashReservePct > 0.05 ? report.cashReservePct : 0;
  const bar = [...legs.map((l) => ({ key: l.symbol, pct: l.pct, color: l.color })), ...(cash ? [{ key: "USDC", pct: cash, color: USDC_BLUE }] : [])];
  const chips = legs.slice(0, cash ? 5 : 6);
  const more = legs.length - chips.length;
  const pctText = (p: number) => `${p >= 10 ? p.toFixed(0) : p.toFixed(1)}%`;
  const quoteSize = prompt.length > 110 ? 32 : prompt.length > 70 ? 38 : 44;

  return new ImageResponse(
    (
      <Frame
        height={630}
        glows={[
          { x: 60, y: 40, size: 760, color: "rgba(124,139,255,0.30)" },
          { x: 1150, y: 660, size: 640, color: "rgba(52,211,153,0.18)" },
        ]}
      >
        <div style={{ position: "absolute", left: 60, right: 60, top: 50, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand mark={mark} />
          <Chip dot="#7c8bff">Agent brief</Chip>
        </div>

        <div style={{ position: "absolute", left: 60, right: 60, top: 136, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 20, color: MUTED, fontWeight: 600, marginBottom: 14 }}>I asked the agent:</div>
          <div
            style={{
              display: "flex",
              padding: "26px 34px",
              borderRadius: "26px 26px 26px 6px",
              border: "1px solid rgba(124,139,255,0.38)",
              backgroundImage: "linear-gradient(135deg, rgba(124,139,255,0.24), rgba(58,209,230,0.10))",
              fontSize: quoteSize,
              fontWeight: 800,
              lineHeight: 1.22,
              letterSpacing: -0.4,
            }}
          >
            {`“${prompt}”`}
          </div>

          {bar.length ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 28, fontSize: 20, color: MUTED, fontWeight: 600 }}>
                <span>It built this basket</span>
                <div style={{ display: "flex", flex: 1, height: 1, backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.22), transparent)" }} />
              </div>
              <div style={{ display: "flex", height: 16, marginTop: 16, gap: 3 }}>
                {bar.map((b, i) => (
                  <div
                    key={b.key}
                    style={{
                      display: "flex",
                      width: `${b.pct}%`,
                      height: "100%",
                      background: b.color,
                      borderRadius: i === 0 ? "8px 0 0 8px" : i === bar.length - 1 ? "0 8px 8px 0" : 0,
                    }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
                {chips.map((l) => (
                  <div key={l.symbol} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderRadius: 14, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
                    { }
                    {l.logo ? <img src={l.logo} width={28} height={28} style={{ borderRadius: 8 }} alt="" /> : null}
                    <span style={{ fontSize: 18, fontWeight: 800 }}>{l.symbol}</span>
                    <span style={{ fontFamily: "Mono", fontSize: 17, color: MUTED }}>{pctText(l.pct)}</span>
                  </div>
                ))}
                {more > 0 ? <div style={{ display: "flex", alignItems: "center", padding: "9px 14px", fontSize: 17, color: MUTED }}>{`+ ${more} more`}</div> : null}
                {cash ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderRadius: 14, background: "rgba(39,117,202,0.14)", border: "1px solid rgba(39,117,202,0.45)" }}>
                    <div style={{ display: "flex", width: 28, height: 28, borderRadius: 28, background: USDC_BLUE, alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800 }}>$</div>
                    <span style={{ fontSize: 18, fontWeight: 800 }}>USDC kept</span>
                    <span style={{ fontFamily: "Mono", fontSize: 17, color: MUTED }}>{pctText(cash)}</span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", marginTop: 30, fontSize: 24, color: MUTED, fontWeight: 600 }}>Open the link to see the basket it builds, then review and sign from your own wallet.</div>
          )}
        </div>

        <Footer left="Rule-based agent · your limits kept · you review and sign · Not financial advice" url="maxxagent.xyz" />
      </Frame>
    ),
    await ogOptions(630, 1800)
  );
}
