import { NextRequest } from "next/server";
import { BASE_TOKENIZED_STOCKS } from "./tokenizedStocks";
import { SEC_CIK } from "./secFundamentals";
import { GET as getHistory } from "@/app/api/history/route";

/**
 * News & filings for the 10 supported stocks, with the price change since each item was published.
 *  - Official filings: each company's own SEC filings (8-K, 10-Q, 10-K…) from EDGAR, last 30 days.
 *  - Headlines: Finnhub company news, last 3 days, only when FINNHUB_API_KEY is set.
 * Only the headline, outlet, time and link are shown (no article text, images or logos). Server only;
 * rebuilt at most every 10 minutes and shared by every visitor.
 */
export interface NewsItem {
  symbol: string;
  kind: "news" | "filing";
  title: string;
  /** outlet domain, or "SEC" */
  source: string;
  url: string;
  publishedAt: string;
  /** price when published and now, from the same source, and the change between them */
  priceThen: number | null;
  priceNow: number | null;
  changePct: number | null;
  priceSource: "DEX" | "NAV" | null;
}

const CACHE_MS = 10 * 60_000;
const USER_AGENT = process.env.SEC_USER_AGENT || "stock-index-research/1.0 (research@example.org)";

// How each company appears in a headline
const NAME_RE: Record<string, RegExp> = {
  NVDAc: /\b(nvidia|nvda)\b/i,
  AAPLc: /\b(apple|aapl|iphone)\b/i,
  TSLAc: /\b(tesla|tsla)\b/i,
  MSFTc: /\b(microsoft|msft)\b/i,
  METAc: /\b(meta platforms|facebook|instagram|zuckerberg)\b|\bmeta\b(?=\s+(?:shares|stock|ai|is|will|says|to|plans|reports|beats|misses))/i,
  GOOGLc: /\b(alphabet|google|googl)\b/i,
  AMZNc: /\b(amazon|amzn|aws)\b/i,
  MSTRc: /\b(microstrategy|strategy inc|saylor|mstr)\b/i,
  SNDKc: /\b(sandisk|sndk)\b/i,
  SPCXc: /\b(spacex|starlink)\b/i,
};

// What an 8-K item number means, in plain words (9.01 is just the exhibit list)
const ITEMS: Record<string, string> = {
  "1.01": "material agreement",
  "1.02": "agreement ended",
  "1.05": "cybersecurity incident",
  "2.01": "acquisition or sale of assets",
  "2.02": "results of operations",
  "2.03": "new debt",
  "2.05": "restructuring costs",
  "2.06": "impairment",
  "3.01": "listing notice",
  "3.02": "unregistered share sale",
  "4.01": "auditor change",
  "5.02": "director or officer change",
  "5.03": "bylaws change",
  "5.07": "shareholder vote results",
  "7.01": "investor disclosure",
  "8.01": "other events",
};
const FORMS: Record<string, string> = {
  "10-K": "Annual report",
  "10-K/A": "Annual report (amended)",
  "10-Q": "Quarterly report",
  "8-K": "Current report",
  "8-K/A": "Current report (amended)",
  "S-1": "Registration statement",
  "6-K": "Foreign issuer report",
  "20-F": "Annual report (foreign issuer)",
};

async function secFilings(): Promise<Omit<NewsItem, "priceThen" | "priceNow" | "changePct" | "priceSource">[]> {
  const since = Date.now() - 30 * 86_400_000;
  const out: Omit<NewsItem, "priceThen" | "priceNow" | "changePct" | "priceSource">[] = [];
  for (const [symbol, cik] of Object.entries(SEC_CIK)) {
    try {
      const res = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const r = (await res.json())?.filings?.recent;
      if (!r?.form) continue;
      for (let i = 0; i < r.form.length && i < 60; i++) {
        const form: string = r.form[i];
        if (!FORMS[form]) continue;
        const at = Date.parse(r.acceptanceDateTime?.[i] || `${r.filingDate[i]}T00:00:00Z`);
        if (!(at >= since)) continue;
        const items = String(r.items?.[i] || "")
          .split(",")
          .map((x) => ITEMS[x.trim()])
          .filter(Boolean);
        const accn = String(r.accessionNumber[i]).replace(/-/g, "");
        out.push({
          symbol,
          kind: "filing",
          title: `${form} ${FORMS[form].toLowerCase()}${items.length ? `: ${items.join(", ")}` : ""}`,
          source: "SEC",
          url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accn}/${r.primaryDocument?.[i] || ""}`,
          publishedAt: new Date(at).toISOString(),
        });
      }
    } catch {
      // one company failing leaves the others
    }
  }
  return out;
}

/**
 * Company headlines from Finnhub (financial news per ticker), only when FINNHUB_API_KEY is set. Without a key
 * the feed shows the SEC filings alone: an open web index (GDELT) was tried and returned mostly off-topic
 * articles, which would mislead more than help.
 */
async function headlines(): Promise<Omit<NewsItem, "priceThen" | "priceNow" | "changePct" | "priceSource">[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return [];
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const to = new Date();
  const from = new Date(Date.now() - 3 * 86_400_000);
  const out: Omit<NewsItem, "priceThen" | "priceNow" | "changePct" | "priceSource">[] = [];
  for (const s of BASE_TOKENIZED_STOCKS) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(s.tickerUnderlying)}&from=${day(from)}&to=${day(to)}&token=${key}`,
        { next: { revalidate: 600 }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const list = (await res.json()) as { headline?: string; source?: string; url?: string; datetime?: number }[];
      const seen = new Set<string>();
      for (const n of Array.isArray(list) ? list : []) {
        const title = (n.headline || "").replace(/\s+/g, " ").trim();
        if (!title || !n.url || !n.datetime || seen.has(title.toLowerCase())) continue;
        // Keep headlines that actually name the company (company feeds include market round-ups)
        if (NAME_RE[s.symbol] && !NAME_RE[s.symbol].test(title)) continue;
        seen.add(title.toLowerCase());
        out.push({ symbol: s.symbol, kind: "news", title: title.slice(0, 200), source: n.source || "news", url: n.url, publishedAt: new Date(n.datetime * 1000).toISOString() });
        if (seen.size >= 8) break;
      }
    } catch {
      // one ticker failing leaves the others
    }
  }
  return out;
}

/** Price series for a symbol: the 24/7 DEX price (hourly, 7 days) or the Chainlink NAV (30 days) */
async function series(symbol: string, tf: "7D" | "30D", navOnly: boolean): Promise<{ dex: [number, number][]; nav: [number, number][] }> {
  try {
    const url = new URL(`http://internal/api/history?symbol=${symbol}&tf=${tf}${navOnly ? "&only=nav" : ""}`);
    const res = await getHistory(new NextRequest(url));
    const body = await res.json();
    return { dex: body?.dex ?? [], nav: body?.nav ?? [] };
  } catch {
    return { dex: [], nav: [] };
  }
}
/** Last price at or before `t` (seconds); null if the series starts after it */
const priceAt = (pts: [number, number][], t: number) => {
  let p: number | null = null;
  for (const [ts, v] of pts) {
    if (ts > t) break;
    p = v;
  }
  return p;
};

async function build(): Promise<NewsItem[]> {
  const [filings, news] = await Promise.all([secFilings(), headlines().catch(() => [])]);
  const raw = [...news, ...filings];
  const symbols = [...new Set(raw.map((x) => x.symbol))].filter((s) => BASE_TOKENIZED_STOCKS.some((b) => b.symbol === s));
  const weekAgo = Date.now() / 1000 - 7 * 86_400;
  const priced: NewsItem[] = [];
  for (const symbol of symbols) {
    // One request per symbol at a time: GeckoTerminal (DEX candles) rate-limits bursts
    const short = await series(symbol, "7D", false);
    const long = raw.some((x) => x.symbol === symbol && Date.parse(x.publishedAt) / 1000 < weekAgo) ? await series(symbol, "30D", true) : { dex: [], nav: [] };
    for (const x of raw.filter((r) => r.symbol === symbol)) {
      const t = Date.parse(x.publishedAt) / 1000;
      const useDex = t >= weekAgo && short.dex.length > 1;
      const pts = useDex ? short.dex : t >= weekAgo ? short.nav : long.nav;
      const then = priceAt(pts, t);
      const now = pts.length ? pts[pts.length - 1][1] : null;
      priced.push({
        ...x,
        priceThen: then,
        priceNow: now,
        changePct: then && now ? ((now - then) / then) * 100 : null,
        priceSource: then && now ? (useDex ? "DEX" : "NAV") : null,
      });
    }
  }
  return priced.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

let cache: { at: number; items: NewsItem[] } | null = null;
let inflight: Promise<NewsItem[]> | null = null;
export const newsPending = () => inflight ?? Promise.resolve();

/** Current feed; waits at most `waitMs` for a rebuild, else serves the previous one (or null if none yet) */
export async function getNews(waitMs = 40_000): Promise<NewsItem[] | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  if (!inflight)
    inflight = build()
      .then((items) => {
        if (items.length) cache = { at: Date.now(), items };
        return items;
      })
      .finally(() => (inflight = null));
  if (cache) return cache.items; // stale-while-revalidate
  const done = await Promise.race([inflight, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
  return done;
}
