import { ImageResponse } from "next/og";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { cleanIndexName, parseBasketParam } from "@/lib/shareBasket";
import { Brand, Chip, Footer, Frame, INK, MUTED, UP, donutPaths, fmtPct, logoUrl, navHistory7d, ogMark, ogOptions, ogOrigin, seriesChangePct, shortCompany, signColor } from "@/lib/og/kit";

/**
 * Share card for a basket: /api/og?basket=NVDAc-40,MSFTc-60&name=…&ticker=…&creator=…&h=800
 * 1200x630 for X and link previews; h=800 gives the 3:2 card Farcaster mini app embeds use.
 * Only the 10 known stocks are drawn. The donut's center shows how the same weights did over the
 * past 7 days of Chainlink NAV, when that loads in time; otherwise the number of stocks.
 */
export const runtime = "nodejs";

const META = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s]));

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const origin = ogOrigin(req);
  const weights = parseBasketParam(q.get("basket")) ?? { NVDAc: 3400, MSFTc: 3300, GOOGLc: 3300 };
  const name = cleanIndexName(q.get("name"), 48) || "Custom stock index";
  const ticker = cleanIndexName(q.get("ticker"), 48);
  const creator = cleanIndexName(q.get("creator"), 24);
  const height = q.get("h") === "800" ? 800 : 630;
  const tall = height === 800;

  const legs = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .map(([symbol, bps]) => {
      const m = META.get(symbol);
      return { symbol, pct: bps / 100, color: m?.color || "#4C6FFF", logo: m ? logoUrl(origin, m.logoUrl) : "", company: shortCompany(m?.companyName || "") };
    });
  const fmt = (p: number) => `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
  const many = legs.length > 5;
  const shown = legs.slice(0, many ? 8 : 5);
  const hidden = legs.length - shown.length;

  // Past 7 days with these weights (each leg's NAV change, weighted); all legs must load or it's left out
  const [mark, hist] = await Promise.all([ogMark(), Promise.all(legs.map((l) => navHistory7d(origin, l.symbol)))]);
  const past7d = hist.every(Boolean) ? legs.reduce((a, l, i) => a + (l.pct / 100) * seriesChangePct(hist[i]!), 0) : null;

  const D = tall ? 420 : 380;
  const arcs = donutPaths(legs.map((l) => l.pct), D / 2, D / 2, D / 2 - 14, D / 2 - 66);
  const maxPct = Math.max(...legs.map((l) => l.pct));
  const top = tall ? 64 : 50;

  return new ImageResponse(
    (
      <Frame
        height={height}
        glows={[
          { x: 930, y: height / 2, size: 760, color: "rgba(76,111,255,0.30)" },
          { x: 120, y: height + 60, size: 620, color: "rgba(52,211,153,0.12)" },
        ]}
      >
        <div style={{ position: "absolute", left: 60, right: 60, top, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand mark={mark} />
          <Chip dot={UP}>{creator ? `Onchain index · by ${creator}` : `${legs.length} tokenized stocks · Base`}</Chip>
        </div>

        <div style={{ position: "absolute", left: 60, top: top + (tall ? 120 : 92), width: 620, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", fontSize: name.length > 26 ? 46 : 60, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1.04 }}>{name}</div>
            {ticker ? (
              <div style={{ display: "flex" }}>
                <Chip mono size={19} color="#c7d2fe" border="rgba(99,102,241,0.55)" bg="rgba(79,70,229,0.16)">
                  {ticker}
                </Chip>
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: many ? 10 : tall ? 18 : 14, marginTop: tall ? 34 : ticker ? 22 : 30 }}>
            {shown.map((l) => (
              <div key={l.symbol} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: many ? 18 : 22 }}>
                { }
                {l.logo ? <img src={l.logo} width={many ? 26 : 34} height={many ? 26 : 34} style={{ borderRadius: 9 }} alt="" /> : null}
                <div style={{ display: "flex", width: many ? 92 : 112, fontWeight: 800 }}>{l.symbol}</div>
                <div style={{ display: "flex", flex: 1, height: many ? 8 : 10, borderRadius: 6, background: "rgba(255,255,255,0.07)" }}>
                  <div style={{ display: "flex", width: `${(l.pct / maxPct) * 100}%`, height: "100%", borderRadius: 6, background: l.color }} />
                </div>
                <div style={{ display: "flex", width: 78, justifyContent: "flex-end", fontFamily: "Mono", fontWeight: 700 }}>{fmt(l.pct)}</div>
              </div>
            ))}
            {hidden > 0 ? <div style={{ display: "flex", fontSize: 17, color: MUTED }}>{`+ ${hidden} more`}</div> : null}
          </div>
        </div>

        <div style={{ position: "absolute", right: 70, top: (height - D) / 2 + (tall ? 10 : 18), width: D, height: D, display: "flex" }}>
          <svg width={D} height={D} viewBox={`0 0 ${D} ${D}`}>
            <circle cx={D / 2} cy={D / 2} r={D / 2 - 40} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={52} />
            {arcs.map((d, i) => (
              <path key={i} d={d} fill={legs[i].color} />
            ))}
          </svg>
          <div style={{ position: "absolute", top: 0, left: 0, width: D, height: D, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            {past7d !== null ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ display: "flex", fontSize: 17, color: MUTED, fontWeight: 600 }}>Past 7 days</div>
                <div style={{ display: "flex", fontFamily: "Mono", fontSize: 46, fontWeight: 700, color: signColor(past7d) }}>{fmtPct(past7d)}</div>
                <div style={{ display: "flex", fontSize: 16, color: MUTED }}>{`${legs.length} stocks · NAV`}</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ display: "flex", fontFamily: "Mono", fontSize: 64, fontWeight: 700, color: INK }}>{legs.length}</div>
                <div style={{ display: "flex", fontSize: 18, color: MUTED, fontWeight: 600 }}>{legs.length === 1 ? "stock" : "stocks"}</div>
              </div>
            )}
          </div>
        </div>

        <Footer
          bottom={tall ? 44 : 34}
          left={
            <div style={{ display: "flex" }}>
              <span style={{ color: UP, fontWeight: 600 }}>Buy the whole basket from your own wallet</span>
              <span>&nbsp;· USDC or ETH · Not financial advice</span>
            </div>
          }
          url="maxxagent.xyz"
        />
      </Frame>
    ),
    await ogOptions(height)
  );
}
