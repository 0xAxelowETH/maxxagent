import { ImageResponse } from "next/og";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { Brand, Chip, Footer, Frame, MUTED, OG_SITE, UP, fmtPct, liveMarket, navHistory7d, ogLogo, ogMark, ogOptions, seriesChangePct, shortCompany, signColor, sparkPaths } from "@/lib/og/kit";

/**
 * Share card for one stock page: logo, live Chainlink NAV, 24h / 7D moves, DEX vs NAV gap and a 7-day line
 * in the stock's color. Live numbers that don't load in time are left out; the card still renders.
 * Served pre-rendered from /api/og/stock/<SYMBOL> (and live from /api/og/stock?symbol=, kept for old links).
 */
export const findStock = (symbol: string) => BASE_TOKENIZED_STOCKS.find((s) => s.symbol.toLowerCase() === symbol.toLowerCase());

export async function stockCard(symbol: string, timeoutMs?: number) {
  const meta = findStock(symbol) ?? BASE_TOKENIZED_STOCKS[0];
  const color = meta.color || "#4C6FFF";

  const [mark, logo, market, hist] = await Promise.all([ogMark(), ogLogo(meta.logoUrl), liveMarket(OG_SITE, timeoutMs), navHistory7d(OG_SITE, meta.symbol, timeoutMs)]);
  const live = market?.stocks.find((s) => s.symbol === meta.symbol);
  const price = live && live.navPrice > 0 ? live.navPrice : hist ? hist[hist.length - 1][1] : null;
  const ch24 = live && Number.isFinite(live.change24hPct) ? live.change24hPct : null;
  const ch7 = hist ? seriesChangePct(hist) : null;
  const gap = live && live.dexPrice24_7 > 0 && live.navPrice > 0 ? (live.dexPrice24_7 / live.navPrice - 1) * 100 : null;
  const W = 520, H = 290;
  const spark = hist ? sparkPaths(hist, W, H) : null;
  const lineColor = color.toLowerCase() === "#000000" || color.toLowerCase() === "#111111" ? "#cbd5e1" : color;

  return new ImageResponse(
    (
      <Frame
        height={630}
        glows={[
          { x: 980, y: 140, size: 820, color: `${color}40` },
          { x: 160, y: 320, size: 520, color: "rgba(76,111,255,0.14)" },
        ]}
      >
        <div style={{ position: "absolute", left: 60, right: 60, top: 50, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand mark={mark} />
          <Chip dot={UP}>Tokenized on Base</Chip>
        </div>

        <div style={{ position: "absolute", left: 60, top: 146, display: "flex", alignItems: "center", gap: 24 }}>
          {logo ? <img src={logo} width={100} height={100} style={{ borderRadius: 26, boxShadow: `0 0 70px ${color}66` }} alt="" /> : null}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 58, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{meta.symbol}</div>
            <div style={{ display: "flex", fontSize: 24, color: MUTED, marginTop: 10 }}>{`${shortCompany(meta.companyName)} · ${meta.sector}`}</div>
          </div>
        </div>

        <div style={{ position: "absolute", left: 60, top: 300, display: "flex", flexDirection: "column" }}>
          {price !== null ? (
            <div style={{ display: "flex", fontFamily: "Mono", fontSize: 84, fontWeight: 700, letterSpacing: -3 }}>{`$${price.toFixed(2)}`}</div>
          ) : (
            <div style={{ display: "flex", fontSize: 40, fontWeight: 800, maxWidth: 560, lineHeight: 1.15 }}>Live Chainlink NAV and 24/7 DEX price</div>
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
            {ch24 !== null ? (
              <Chip mono color={signColor(ch24)} border={`${signColor(ch24)}66`}>
                {`24h ${fmtPct(ch24)}`}
              </Chip>
            ) : null}
            {ch7 !== null ? (
              <Chip mono color={signColor(ch7)} border={`${signColor(ch7)}66`}>
                {`7D ${fmtPct(ch7)}`}
              </Chip>
            ) : null}
            {gap !== null ? <Chip mono>{`DEX vs NAV ${fmtPct(gap)}`}</Chip> : null}
          </div>
        </div>

        {spark ? (
          <div style={{ position: "absolute", right: 60, top: 168, width: W, height: H, display: "flex" }}>
            <svg width={W} height={H + 20} viewBox={`0 0 ${W} ${H + 20}`}>
              <defs>
                <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={lineColor} stopOpacity="0.38" />
                  <stop offset="1" stopColor={lineColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={spark.area} fill="url(#fill)" />
              <path d={spark.line} fill="none" stroke={lineColor} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={spark.last[0]} cy={spark.last[1]} r={16} fill={lineColor} fillOpacity={0.22} />
              <circle cx={spark.last[0]} cy={spark.last[1]} r={7} fill={lineColor} />
            </svg>
          </div>
        ) : null}

        <Footer left="Chainlink NAV · 24/7 DEX price · Not financial advice" url={`maxxagent.xyz/stock/${meta.symbol}`} />
      </Frame>
    ),
    await ogOptions(630, 1800)
  );
}
