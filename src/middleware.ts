import { NextRequest, NextResponse } from "next/server";
import { miniappEmbedTags } from "@/lib/miniappEmbed";
import { basketImagePath, cleanIndexName, parseBasketParam } from "@/lib/shareBasket";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { BANKR_DESCRIPTION, BANKR_TITLE, INDEX_DESCRIPTION_FALLBACK, SITE_DESCRIPTION, SITE_TITLE, indexTitleFallback, ogPaths, stockDescription, stockTitle } from "@/lib/siteMeta";

/**
 * Coinbase tokenized stocks are only available to persons in eligible jurisdictions
 * outside of the U.S., and integrators are responsible for applying restrictions.
 * Blocks U.S. (and U.S. territory) visitors when the hosting platform provides a geo header
 * (Vercel: x-vercel-ip-country, Cloudflare: cf-ipcountry). The in-app attestation still applies.
 */
const BLOCKED_COUNTRIES = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM"]);

// Server-to-server endpoints (Vercel Cron and Farcaster's webhook run in the US) and public health monitors stay reachable
// "/preview" is the read-only, no-trading page for reviewers anywhere (informational only, rendered on the server)
const PUBLIC_EXACT = new Set(["/preview", "/agent-registration.json", "/api/og", "/api/miniapp/webhook", "/api/health", "/robots.txt", "/sitemap.xml", "/icon.svg", "/apple-icon.png", "/favicon.ico"]);
// "/api/og/" = the share card images (home, per stock, agent): read-only pictures that preview crawlers fetch from the US
// "/api/skill/" = read-only basket proposals and prices for the MAXXAGENT Baskets skill (Bankr's agents call it
// from their servers); it never trades, and the buy link it returns opens the geo-gated site
const PUBLIC_PREFIXES = ["/.well-known/", "/api/cron/", "/api/og/", "/api/skill/", "/brand/"];
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, "");
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const EARLY_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'self' https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com https://base.app https://*.base.app https://base.dev https://*.base.dev",
};
// Same titles, descriptions, share cards and embeds as the real pages (see src/lib/siteMeta.ts), because
// preview crawlers (X, Farcaster, Telegram…) run in the US and get this page instead of the app
const previewTags = (path: string, searchParams?: URLSearchParams) => {
  // Only the 10 listed symbols: never reflect arbitrary URL text into the preview
  const asked = path.match(/^\/stock\/([A-Za-z]{2,8}c)$/)?.[1]?.toLowerCase();
  const stock = BASE_TOKENIZED_STOCKS.find((s) => s.symbol.toLowerCase() === asked);
  const indexId = path.match(/^\/index\/(\d{1,9})$/)?.[1];
  const parsedBasket = path === "/" ? parseBasketParam(searchParams?.get("basket")) : null;
  const rawName = parsedBasket ? cleanIndexName(searchParams?.get("name"), 48) : "";
  const rawTicker = parsedBasket ? cleanIndexName(searchParams?.get("ticker"), 24) : "";
  // An agent link (/?tab=agent&prompt=…) on the home page
  const prompt = path === "/" && !parsedBasket ? cleanIndexName(searchParams?.get("prompt"), 160) : "";
  const legs = parsedBasket
    ? Object.entries(parsedBasket)
        .sort((a, b) => b[1] - a[1])
        .map(([sym, w]) => `${sym} ${Number((w / 100).toFixed(1))}%`)
        .join(", ")
    : "";

  let title = SITE_TITLE;
  let description = SITE_DESCRIPTION;
  let ogImage = `${SITE}${ogPaths.home.card}`;
  let embed: Parameters<typeof miniappEmbedTags>[0] = { siteUrl: SITE };
  let url = SITE + "/";
  if (path === "/bankr") {
    title = BANKR_TITLE;
    description = BANKR_DESCRIPTION;
    ogImage = `${SITE}${ogPaths.bankr.card}`;
    embed = { siteUrl: SITE, path: "/bankr", buttonTitle: "Use it in Bankr", imageUrl: `${SITE}${ogPaths.bankr.tall}` };
    url = `${SITE}/bankr`;
  } else if (stock) {
    title = stockTitle(stock);
    description = stockDescription(stock);
    const og = ogPaths.stock(stock.symbol);
    ogImage = `${SITE}${og.card}`;
    embed = { siteUrl: SITE, path: `/stock/${stock.symbol}`, buttonTitle: `Trade ${stock.symbol}`, imageUrl: `${SITE}${og.tall}` };
    url = `${SITE}/stock/${stock.symbol}`;
  } else if (indexId) {
    // The registry isn't read here (no RPC in middleware); the pre-rendered card carries the index's name and weights
    title = indexTitleFallback(indexId);
    description = INDEX_DESCRIPTION_FALLBACK;
    const og = ogPaths.index(indexId);
    ogImage = `${SITE}${og.card}`;
    embed = { siteUrl: SITE, path: `/index/${indexId}`, buttonTitle: `Buy index #${indexId}`, imageUrl: `${SITE}${og.tall}` };
    url = `${SITE}/index/${indexId}`;
  } else if (parsedBasket) {
    const name = rawName || "Custom stock index";
    title = `${name} — tokenized stock index on Base`;
    description = `${legs}. Buy the whole basket from your own wallet with USDC or ETH on MAXXAGENT. Not financial advice.`;
    ogImage = `${SITE}${basketImagePath(parsedBasket, { name, ticker: rawTicker || undefined })}`;
    embed = { siteUrl: SITE, buttonTitle: "Buy this basket", imageUrl: `${SITE}${basketImagePath(parsedBasket, { name, ticker: rawTicker || undefined, tall: true })}` };
    url = `${SITE}/?${searchParams}`;
  } else if (prompt) {
    title = `“${prompt}” — MAXXAGENT agent basket`;
    description = "A rule-based agent turns this request into a basket of tokenized stocks on Base. Review it and buy from your own wallet. Not financial advice.";
    ogImage = `${SITE}/api/og/agent?${new URLSearchParams({ prompt })}`;
    url = `${SITE}/?${new URLSearchParams({ tab: "agent", prompt })}`;
  }
  const tags: [string, string][] = [
    ["description", description],
    ["og:type", "website"],
    ["og:site_name", "MAXXAGENT"],
    ["og:url", url],
    ["og:title", title],
    ["og:description", description],
    ["og:image", ogImage],
    ["og:image:width", "1200"],
    ["og:image:height", "630"],
    ["twitter:card", "summary_large_image"],
    ["twitter:title", title],
    ["twitter:description", description],
    ["twitter:image", ogImage],
    ...Object.entries(miniappEmbedTags(embed)),
  ];
  return (
    `<title>${esc(title)}</title>` +
    tags
      .map(([k, v]) => (k.startsWith("og:") ? `<meta property="${k}" content="${esc(v)}">` : `<meta name="${k}" content="${esc(v)}">`))
      .join("")
  );
};

/**
 * Best-effort per-IP rate limit for API routes (fixed 60s window, per server instance).
 * Protects shared third-party quotas (KyberSwap, GeckoTerminal, public RPC) from a single client.
 */
const LIMITS: Record<string, number> = {
  "/api/swap": 90,
  "/api/agent": 30,
  "/api/history": 90,
  "/api/stocks": 90,
  "/api/indexes": 60,
  "/api/pnl": 20,
  "/api/stats": 30,
  "/api/news": 60,
  "/api/paired": 30,
  "/api/health": 30,
  "/api/watch": 20,
  "/api/cron": 5,
  "/api/replay": 30,
  "/api/miniapp/webhook": 30,
  "/api/og": 60,
  "/api/skill/basket": 20,
  "/api/skill/stocks": 60,
  "/preview": 30,
};
const WINDOW_MS = 60_000;
const hits = new Map<string, { start: number; count: number }>();

function rateLimited(request: NextRequest): { limited: boolean; retryAfter: number } {
  const route = Object.keys(LIMITS).find((r) => request.nextUrl.pathname.startsWith(r));
  if (!route) return { limited: false, retryAfter: 0 };
  const xff = request.headers.get("x-forwarded-for");
  const lastHop = xff ? xff.split(",").at(-1)?.trim() : undefined;
  const trustCf = process.env.TRUST_CF_HEADERS === "1";
  const ip =
    (trustCf ? request.headers.get("cf-connecting-ip")?.trim() : undefined) ||
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    lastHop ||
    "local";
  const key = `${route}|${ip}`;
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    if (entry) hits.delete(key);
    hits.set(key, { start: now, count: 1 });
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
      // Evict non-rate-limited entries before ever dropping active rate-limit blocks
      if (hits.size > 5000) {
        let drop = hits.size - 5000;
        for (const [k, v] of hits) {
          const rPath = k.split("|")[0];
          if (v.count <= (LIMITS[rPath] ?? 60)) {
            hits.delete(k);
            if (--drop <= 0) break;
          }
        }
        if (drop > 0) {
          for (const k of hits.keys()) {
            hits.delete(k);
            if (--drop <= 0) break;
          }
        }
      }
    }
    return { limited: false, retryAfter: 0 };
  }
  entry.count++;
  return { limited: entry.count > LIMITS[route], retryAfter: Math.ceil((WINDOW_MS - (now - entry.start)) / 1000) };
}

/**
 * One canonical domain: once CANONICAL_HOST is set (e.g. maxxagent.xyz), the old production alias
 * permanently redirects there with the same path and query. Preview deployments are left alone.
 */
const CANONICAL_HOST = (process.env.CANONICAL_HOST || "").toLowerCase();
const OLD_HOSTS = new Set(["maxxagent-wine.vercel.app", "www.maxxagent.xyz"]);

export function middleware(request: NextRequest) {
  const host = (request.headers.get("host") || "").toLowerCase();
  if (CANONICAL_HOST && host !== CANONICAL_HOST && OLD_HOSTS.has(host)) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  const rawPath = request.nextUrl.pathname;
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") || "/" : rawPath;
  if (path.startsWith("/api/") || path === "/preview") {
    const { limited, retryAfter } = rateLimited(request);
    if (limited) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Please wait a moment." },
        { status: 429, headers: { ...EARLY_SECURITY_HEADERS, "Retry-After": String(retryAfter) } }
      );
    }
  }

  const cfCountry = (request.headers.get("cf-ipcountry") || "").toUpperCase();
  const vercelCountry = (request.headers.get("x-vercel-ip-country") || "").toUpperCase();

  if (!BLOCKED_COUNTRIES.has(cfCountry) && !BLOCKED_COUNTRIES.has(vercelCountry)) {
    return NextResponse.next();
  }

  // Public, non-trading files stay reachable from everywhere: link-preview and mini app crawlers
  // (X, Farcaster…) run in the US and would otherwise get 451 for the manifest and images
  if (PUBLIC_EXACT.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return NextResponse.next();

  if (path.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "Not available in your jurisdiction." },
      { status: 451, headers: EARLY_SECURITY_HEADERS }
    );
  }

  // Same block page for people, but with the site's preview tags so shared links still render a card.
  // 200 because preview crawlers ignore tags on error pages; the app itself and every API stay blocked.
  return new NextResponse(
    "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
      previewTags(path, request.nextUrl.searchParams) +
      "</head><body style='font-family:system-ui;background:#050811;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px'>" +
      "<div style='max-width:480px'><h1 style='font-size:20px'>Not available in your jurisdiction</h1>" +
      "<p style='color:#94a3b8;font-size:14px;line-height:1.6'>Coinbase tokenized stocks on Base are only available to persons in eligible jurisdictions outside of the United States.</p>" +
      "<p style='font-size:13px'><a href='/preview' style='color:#67e8f9'>View a read-only preview (no trading)</a></p></div></body></html>",
    {
      status: 200,
      headers: {
        ...EARLY_SECURITY_HEADERS,
        "content-type": "text/html; charset=utf-8",
        "x-geo-blocked": "1",
        "cache-control": "private, no-store",
      },
    }
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon\\.svg|apple-icon\\.png|logos/).*)"],
};
