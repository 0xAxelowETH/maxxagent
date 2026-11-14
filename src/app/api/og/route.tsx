import { ImageResponse } from "next/og";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { cleanIndexName, parseBasketParam } from "@/lib/shareBasket";

/**
 * Share card for a basket: /api/og?basket=NVDAc-40,MSFTc-60&name=…&ticker=…&h=800
 * 1200x630 for X and link previews; h=800 gives the 3:2 card Farcaster mini app embeds use.
 * Only the 10 known stocks are drawn; names are cleaned and shortened.
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
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: tall ? "64px 72px" : "52px 64px",
          background: "linear-gradient(135deg, #03060e 0%, #0a1230 60%, #10184a 100%)",
          color: "#e2e8f0",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 800, color: "#ffffff", letterSpacing: 1 }}>MAXXAGENT</div>
          <div style={{ display: "flex", fontSize: 22, color: "#93c5fd" }}>Tokenized stock index on Base</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: name.length > 30 ? 52 : 64, fontWeight: 800, color: "#ffffff", lineHeight: 1.1 }}>{name}</div>
          {ticker ? <div style={{ display: "flex", marginTop: 10, fontSize: 26, color: "#67e8f9" }}>{ticker}</div> : null}
          <div style={{ display: "flex", marginTop: tall ? 36 : 26, height: 26, width: "100%", borderRadius: 13, overflow: "hidden" }}>
            {legs.map((l) => (
              <div key={l.symbol} style={{ display: "flex", width: `${l.pct}%`, height: "100%", background: l.color }} />
            ))}
          </div>
          <div style={{ display: "flex", marginTop: tall ? 32 : 22, gap: 56 }}>
            {columns.map((col, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: tall ? 14 : 8, flex: 1 }}>
                {col.map((l) => (
                  <div key={l.symbol} style={{ display: "flex", alignItems: "center", fontSize: legs.length > 5 ? 24 : 28 }}>
                    <div style={{ display: "flex", width: 16, height: 16, borderRadius: 8, background: l.color, marginRight: 14 }} />
                    <div style={{ display: "flex", fontWeight: 700, color: "#ffffff", width: 130 }}>{l.symbol}</div>
                    <div style={{ display: "flex", color: "#94a3b8", flex: 1 }}>{l.company}</div>
                    <div style={{ display: "flex", fontWeight: 700, color: "#ffffff" }}>{fmt(l.pct)}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 24, color: "#6ee7b7", fontWeight: 700 }}>Buy the whole basket from your own wallet</div>
            <div style={{ display: "flex", fontSize: 18, color: "#64748b", marginTop: 6 }}>USDC or ETH · Coinbase tokenized stocks · Not financial advice</div>
          </div>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 800, color: "#ffffff" }}>maxxagent.xyz</div>
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
