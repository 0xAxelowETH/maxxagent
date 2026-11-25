import { ImageResponse } from "next/og";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { Brand, Chip, Footer, Frame, INK, MUTED, OG_SITE, UP, fmtPct, fmtUsd, liveMarket, ogLogos, ogMark, ogOptions, signColor } from "@/lib/og/kit";

/**
 * Site-wide share card (/api/og/home, and /api/og/home/tall for the 3:2 embed): headline on the left, the 10 stocks as a live wall on the right
 * (logo, Chainlink NAV, 24h move), and the total tokenized on Base in the footer.
 * Pre-rendered and refreshed in the background every hour (ISR): link-preview crawlers give up after a few
 * seconds, so they must never wait for a render. If live data doesn't load in time the tiles show the
 * stocks without numbers.
 */
export async function homeCard(height: 630 | 800 = 630) {
  // 800 = the 3:2 Farcaster / Base App embed: same layout, content centered, header and footer at the edges
  const dy = height === 800 ? 85 : 0;
  const stocks10 = BASE_TOKENIZED_STOCKS.slice(0, 10);
  const [mark, market, logos] = await Promise.all([ogMark(), liveMarket(OG_SITE, 20000), ogLogos(stocks10)]);
  const live = new Map((market?.stocks ?? []).map((s) => [s.symbol, s]));
  const tiles = stocks10.map((m) => {
    const s = live.get(m.symbol);
    return { symbol: m.symbol, logo: logos.get(m.symbol) || "", price: s && s.navPrice > 0 ? s.navPrice : null, ch: s && Number.isFinite(s.change24hPct) ? s.change24hPct : null };
  });
  const columns = [tiles.filter((_, i) => i % 2 === 0), tiles.filter((_, i) => i % 2 === 1)];

  const Tile = ({ t }: { t: (typeof tiles)[number] }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: 266,
        height: 76,
        padding: "0 16px",
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.09)",
        backgroundImage: "linear-gradient(160deg, rgba(255,255,255,0.085), rgba(255,255,255,0.02))",
        boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
      }}
    >
      { }
      {t.logo ? <img src={t.logo} width={42} height={42} style={{ borderRadius: 11 }} alt="" /> : null}
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", fontSize: 19, fontWeight: 800 }}>{t.symbol}</div>
        {t.price !== null ? <div style={{ display: "flex", fontFamily: "Mono", fontSize: 15, color: MUTED }}>{`$${t.price.toFixed(2)}`}</div> : null}
      </div>
      {t.ch !== null ? <div style={{ display: "flex", fontFamily: "Mono", fontSize: 15, fontWeight: 700, color: signColor(t.ch) }}>{fmtPct(t.ch)}</div> : null}
    </div>
  );

  const stats = market?.tvlUsd && market.volume24hUsd ? market : null;

  return new ImageResponse(
    (
      <Frame
        height={height}
        glows={[
          { x: 980, y: 60 + dy, size: 900, color: "rgba(76,111,255,0.34)" },
          { x: 760, y: 700 + 2 * dy, size: 640, color: "rgba(52,211,153,0.16)" },
        ]}
      >
        <div style={{ position: "absolute", left: 60, top: dy ? 64 : 54, display: "flex" }}>
          <Brand mark={mark} />
        </div>

        <div style={{ position: "absolute", left: 60, top: 150 + dy, width: 480, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 64, fontWeight: 800, lineHeight: 1.02, letterSpacing: -1.8 }}>
            <span>Your stock index.</span>
            <span style={{ backgroundImage: "linear-gradient(90deg, #7c8bff, #3ad1e6 55%, #34d399)", backgroundClip: "text", color: "transparent" }}>Onchain.</span>
          </div>
          <div style={{ display: "flex", marginTop: 22, fontSize: 22, lineHeight: 1.42, color: "#aab4cf" }}>
            Pick from 10 tokenized stocks or tell the agent what you want. Buy the whole basket from your own wallet.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
            <Chip dot={UP}>Live on Base</Chip>
            <Chip>Chainlink NAV</Chip>
          </div>
        </div>

        <div style={{ position: "absolute", right: 58, top: 78 + dy, display: "flex", gap: 16, transform: "rotate(-4deg)" }}>
          {columns.map((col, ci) => (
            <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: ci ? 34 : 0 }}>
              {col.map((t) => (
                <Tile key={t.symbol} t={t} />
              ))}
            </div>
          ))}
        </div>

        <Footer
          bottom={dy ? 44 : 34}
          left={
            stats ? (
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ fontFamily: "Mono", fontWeight: 700, color: INK }}>{fmtUsd(stats.tvlUsd!)}</span>
                <span>&nbsp;tokenized on Base ·&nbsp;</span>
                <span style={{ fontFamily: "Mono", fontWeight: 700, color: INK }}>{fmtUsd(stats.volume24hUsd!)}</span>
                <span>&nbsp;24h DEX volume · Not financial advice</span>
              </div>
            ) : (
              "Non-custodial · eligible non-US persons only · Not financial advice"
            )
          }
          url="maxxagent.xyz"
        />
      </Frame>
    ),
    await ogOptions(height, 3600)
  );
}
