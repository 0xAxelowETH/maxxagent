import { ImageResponse } from "next/og";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { Brand, Chip, Footer, Frame, INK, MUTED, UP, ogLogos, ogMark, ogOptions } from "@/lib/og/kit";

/**
 * Share card for /bankr (the MAXXAGENT Baskets skill guide): what the skill does, an example chat in
 * Bankr and how to install it. The basket is the real answer from our first test in a Bankr agent
 * (2026-11-25), labelled as an example. Static: pre-rendered by /api/og/bankr and /api/og/bankr/tall.
 */
const EXAMPLE = [
  { symbol: "GOOGLc", pct: "29.7%" },
  { symbol: "MSFTc", pct: "19.35%" },
  { symbol: "METAc", pct: "15.75%" },
  { symbol: "NVDAc", pct: "13.05%" },
  { symbol: "SNDKc", pct: "12.15%" },
];
const META = new Map(BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s]));
const GRAD = { backgroundImage: "linear-gradient(90deg, #7c8bff, #3ad1e6 55%, #34d399)", backgroundClip: "text", color: "transparent" } as const;
const BANKR_PURPLE = "#8b5cf6";

export async function bankrCard(height: 630 | 800 = 630) {
  const dy = height === 800 ? 85 : 0;
  const [mark, logos] = await Promise.all([ogMark(), ogLogos(EXAMPLE.map((e) => ({ symbol: e.symbol, logoUrl: META.get(e.symbol)!.logoUrl })))]);

  return new ImageResponse(
    (
      <Frame
        height={height}
        glows={[
          { x: 1000, y: 260 + dy, size: 820, color: "rgba(139,92,246,0.26)" },
          { x: 120, y: 120 + dy, size: 640, color: "rgba(76,111,255,0.20)" },
        ]}
      >
        <div style={{ position: "absolute", left: 60, right: 60, top: dy ? 64 : 50, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand mark={mark} />
          <Chip dot={BANKR_PURPLE} color="#ddd6fe" border="rgba(139,92,246,0.5)" bg="rgba(139,92,246,0.14)">
            Bankr skill · MAXXAGENT Baskets
          </Chip>
        </div>

        <div style={{ position: "absolute", left: 60, top: 150 + dy, width: 500, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 54, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.4 }}>
            <span>Ask Bankr.</span>
            <span style={GRAD}>Get a stock basket.</span>
          </div>
          <div style={{ display: "flex", marginTop: 22, fontSize: 21, lineHeight: 1.45, color: "#aab4cf" }}>
            Plain English in. A basket of tokenized stocks on Base out: weights, the limits it kept, every number with its source. You buy it from your own wallet.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <Chip dot={UP}>No API key</Chip>
            <Chip>Never trades</Chip>
            <Chip>You sign</Chip>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 60,
            top: 122 + dy,
            width: 520,
            display: "flex",
            flexDirection: "column",
            gap: 11,
            padding: "18px 22px",
            borderRadius: 24,
            background: "rgba(10,14,30,0.86)",
            border: "1px solid rgba(139,92,246,0.35)",
            boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 15, color: MUTED }}>
            <span style={{ fontWeight: 600 }}>In your Bankr agent</span>
            <span style={{ fontFamily: "Mono", fontWeight: 700, fontSize: 13, color: "#a78bfa" }}>EXAMPLE</span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div
              style={{
                display: "flex",
                maxWidth: 400,
                padding: "12px 16px",
                borderRadius: "18px 18px 4px 18px",
                background: "rgba(139,92,246,0.22)",
                border: "1px solid rgba(139,92,246,0.4)",
                fontSize: 18,
                lineHeight: 1.35,
                color: INK,
              }}
            >
              build me a basket: AI and cloud, anything but Tesla, cap each at 30%, keep 10% in cash
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {EXAMPLE.map((e) => (
              <div key={e.symbol} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 18 }}>
                {logos.get(e.symbol) ? <img src={logos.get(e.symbol)} width={26} height={26} style={{ borderRadius: 7 }} alt="" /> : null}
                <span style={{ fontWeight: 800, width: 96 }}>{e.symbol}</span>
                <span style={{ fontFamily: "Mono", fontWeight: 700, color: "#cbd5e1" }}>{e.pct}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 18 }}>
              <div style={{ display: "flex", width: 26, height: 26, borderRadius: 26, background: "#2775ca", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800 }}>$</div>
              <span style={{ fontWeight: 800, width: 96 }}>USDC</span>
              <span style={{ fontFamily: "Mono", fontWeight: 700, color: "#cbd5e1" }}>10% kept</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 7 }}>
            {["max 30% kept", "10% USDC kept", "no Tesla kept"].map((t) => (
              <div key={t} style={{ display: "flex", padding: "4px 9px", borderRadius: 999, fontFamily: "Mono", fontSize: 13, fontWeight: 700, color: UP, border: "1px solid rgba(52,211,153,0.45)", background: "rgba(52,211,153,0.10)" }}>
                {`✓ ${t}`}
              </div>
            ))}
          </div>
        </div>

        <Footer
          bottom={dy ? 44 : 34}
          left={
            <div style={{ display: "flex", fontFamily: "Mono", fontSize: 15, color: "#94a3b8" }}>
              <span style={{ color: "#a78bfa" }}>install the skill from</span>
              <span>&nbsp;github.com/0xAxelowETH/maxxagent · Not financial advice</span>
            </div>
          }
          url="maxxagent.xyz/bankr"
        />
      </Frame>
    ),
    await ogOptions(height, 86400)
  );
}
