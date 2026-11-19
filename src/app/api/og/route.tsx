import { ImageResponse } from "next/og";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { cleanIndexName, parseBasketParam } from "@/lib/shareBasket";

/**
 * Share card for a basket: /api/og?basket=NVDAc-40,MSFTc-60&name=…&ticker=…&creator=…&h=800
 * 1200x630 for X and link previews; h=800 gives the 3:2 card Farcaster mini app embeds use.
 * Only the 10 known stocks are drawn; names are cleaned and shortened with zero external RPC fetches.
 */
export const runtime = "edge";

const META = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s]));

/** "NVIDIA Corporation" -> "NVIDIA", "Space Exploration Technologies Corp." -> "SpaceX": one line per stock */
const shortCompany = (n: string) =>
  /^Space Exploration/.test(n) ? "SpaceX" : n.replace(/,?\s+(Inc\.?|Corporation|Corp\.?|Platforms Inc\.?|\.com Inc\.?)$/, "").replace(/\.com$/, "");

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const weights = parseBasketParam(q.get("basket")) ?? { NVDAc: 3400, MSFTc: 3300, GOOGLc: 3300 };
  const name = cleanIndexName(q.get("name"), 48) || "Custom stock index";
  const ticker = cleanIndexName(q.get("ticker"), 48);
  const creator = cleanIndexName(q.get("creator"), 24);
  const height = q.get("h") === "800" ? 800 : 630;
  const tall = height === 800;

  const legs = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .map(([symbol, bps]) => ({ symbol, pct: bps / 100, color: META.get(symbol)?.color || "#4C6FFF", company: shortCompany(META.get(symbol)?.companyName || "") }));
  const fmt = (p: number) => `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
  const half = Math.ceil(legs.length / 2);
  const columns = legs.length > 5 ? [legs.slice(0, half), legs.slice(half)] : [legs];

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: tall ? "56px 68px" : "44px 60px",
          background: "linear-gradient(135deg, #03060e 0%, #08122b 55%, #0f1947 100%)",
          color: "#e2e8f0",
          fontFamily: "sans-serif",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -120,
            top: -120,
            width: 440,
            height: 440,
            borderRadius: 220,
            background: "radial-gradient(circle, rgba(76, 111, 255, 0.28) 0%, rgba(34, 211, 238, 0.04) 65%, transparent 100%)",
            display: "flex",
          }}
        />

        {/* Top Bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "linear-gradient(135deg, #4C6FFF 0%, #22d3ee 100%)",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24">
                <path d="M4 18V6L12 13L20 6V18" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </div>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: "#ffffff", letterSpacing: 1 }}>MAXXAGENT</div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              borderRadius: 999,
              border: "1px solid rgba(56, 189, 248, 0.35)",
              background: "rgba(14, 116, 144, 0.18)",
              padding: "8px 18px",
              fontSize: 19,
              fontWeight: 600,
              color: "#a5f3fc",
            }}
          >
            {creator ? `Onchain Index · by ${creator}` : `${legs.length} B20 stocks · Base Mainnet`}
          </div>
        </div>

        {/* Index Headline + Framed Composition Card */}
        <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
            <div style={{ display: "flex", fontSize: name.length > 30 ? 48 : 58, fontWeight: 800, color: "#ffffff", lineHeight: 1.08 }}>{name}</div>
            {ticker ? (
              <div
                style={{
                  display: "flex",
                  borderRadius: 10,
                  border: "1px solid rgba(96, 165, 250, 0.45)",
                  background: "rgba(76, 111, 255, 0.2)",
                  padding: "6px 14px",
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#bfdbfe",
                }}
              >
                {ticker}
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: tall ? 28 : 20,
              borderRadius: 20,
              border: "1px solid rgba(51, 65, 85, 0.78)",
              background: "rgba(7, 11, 22, 0.76)",
              padding: tall ? "26px 30px" : "20px 26px",
            }}
          >
            <div style={{ display: "flex", height: 22, width: "100%", borderRadius: 11, overflow: "hidden", background: "#1e293b" }}>
              {legs.map((l) => (
                <div key={l.symbol} style={{ display: "flex", width: `${l.pct}%`, height: "100%", background: l.color }} />
              ))}
            </div>
            <div style={{ display: "flex", marginTop: tall ? 24 : 18, gap: 48 }}>
              {columns.map((col, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: tall ? 14 : 9, flex: 1 }}>
                  {col.map((l) => (
                    <div key={l.symbol} style={{ display: "flex", alignItems: "center", fontSize: legs.length > 5 ? 22 : 26 }}>
                      <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: l.color, marginRight: 12 }} />
                      <div style={{ display: "flex", fontWeight: 700, color: "#ffffff", width: 118 }}>{l.symbol}</div>
                      <div style={{ display: "flex", color: "#94a3b8", flex: 1 }}>{l.company}</div>
                      <div style={{ display: "flex", fontWeight: 700, color: "#67e8f9" }}>{fmt(l.pct)}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", position: "relative" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 22, color: "#6ee7b7", fontWeight: 700 }}>Buy the whole basket from your own wallet</div>
            <div style={{ display: "flex", fontSize: 17, color: "#94a3b8", marginTop: 4 }}>USDC or ETH · Live Chainlink NAV · ERC-8021 · Not financial advice</div>
          </div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 800, color: "#ffffff" }}>maxxagent.xyz</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height,
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
    }
  );
}
