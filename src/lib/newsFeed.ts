import { NextRequest } from "next/server";
import { BASE_TOKENIZED_STOCKS } from "./tokenizedStocks";
import { SEC_CIK } from "./secFundamentals";
import { GET as getHistory } from "@/app/api/history/route";

/**
 * News & filings for the 10 supported stocks, with the price change since each item was published.
 *  - Official filings: each company's own SEC filings (8-K, 10-Q, 10-K…) from EDGAR, last 30 days.
 *  - Headlines: Finnhub company news, last 3 days, only when FINNHUB_API_KEY is set.
 * Shown: the headline or filing title, a short summary (the news provider's own teaser, or the opening
 * sentence of an 8-K), the outlet, time and a link to the original. Never the article text, images or
 * outlet logos. Server only; rebuilt at most every 10 minutes and shared by every visitor.
 */
export interface NewsItem {
  symbol: string;
  kind: "news" | "filing";
  title: string;
  /** 1–2 sentences: the provider's teaser for news, the opening of an 8-K for filings (may be empty) */
  summary?: string;
  /** SEC form code for filings (8-K, 10-Q…) */
  form?: string;
  /** a filing whose title and summary come from the press release the company attached to it */
  pressRelease?: boolean;
  /** what an 8-K is about, in short labels ("Earnings", "Leadership change"…) */
  tags?: string[];
  /** outlet name, or "SEC" */
  source: string;
  url: string;
  publishedAt: string;
  /** price when published and now, from the same source, and the change between them */
  priceThen: number | null;
  priceNow: number | null;
  changePct: number | null;
  priceSource: "DEX" | "NAV" | null;
}

const CACHE_MS = 15 * 60_000;
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
// The same items as short topic labels for the feed
const TAGS: Record<string, string> = {
  "1.01": "Agreement",
  "1.02": "Agreement ended",
  "1.05": "Cybersecurity",
  "2.01": "Acquisition",
  "2.02": "Earnings",
  "2.03": "New debt",
  "2.05": "Restructuring",
  "2.06": "Impairment",
  "3.01": "Listing",
  "3.02": "Share sale",
  "4.01": "Auditor change",
  "5.02": "Leadership change",
  "5.03": "Bylaws",
  "5.07": "Shareholder vote",
  "7.01": "Investor update",
  "8.01": "Other events",
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

/** "NVIDIA Corporation" -> "NVIDIA", "Meta Platforms Inc." -> "Meta Platforms" */
const companyOf = (symbol: string) =>
  (BASE_TOKENIZED_STOCKS.find((s) => s.symbol === symbol)?.companyName || symbol)
    .replace(/^Space Exploration Technologies.*/, "SpaceX")
    .replace(/,?\s+(Inc\.?|Corporation|Corp\.?)$/, "");

/** HTML document -> text; `lines` keeps block boundaries (used to find a press release's headline) */
function htmlText(html: string, lines = false): string {
  return html
    .slice(0, 600_000)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, lines ? "\n" : " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/gi, "-")
    .replace(/&amp;/gi, "&")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(lines ? /[ \t\r\f\v]+/g : /\s+/g, " ");
}
/** First sentence of a text, at most ~220 characters. "Inc.", "Corp.", "U.S." and the like don't end it. */
function firstSentence(body: string): string {
  const ABBR = /\b(?:Inc|Corp|Co|Ltd|LLC|L\.P|N\.A|U\.S|No|St|Mr|Ms|Dr|Jr|Sr|vs|approx|e\.g|i\.e|Calif|Ariz|Tex|Wash|Del|Nev)\.$/i;
  let end = -1;
  for (const dot of body.matchAll(/\.(?=\s+[A-Z("]|$)/g)) {
    if (!ABBR.test(body.slice(0, dot.index! + 1))) {
      end = dot.index! + 1;
      break;
    }
  }
  const s = (end > 0 ? body.slice(0, end) : body).trim();
  return s.length > 220 ? `${s.slice(0, 217).replace(/\s+\S*$/, "")}…` : s;
}
const secGet = (url: string) =>
  fetch(url, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 86_400 }, signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.text() : null));

/** First sentence after an 8-K's first real item heading (not 9.01 exhibits) */
async function filingOpening(url: string): Promise<string | null> {
  const html = await secGet(url).catch(() => null);
  if (!html) return null;
  const text = htmlText(html);
  const re = /Item\s+(\d\.\d{2})\.?\s+[A-Z][^.]{0,120}?\.\s+((?:On|The|As|In|Effective|Today|Beginning)\b[^]{0,600})/g;
  for (const m of text.matchAll(re)) if (m[1] !== "9.01") return firstSentence(m[2]);
  return null;
}

/**
 * The press release a company attached to an 8-K (Exhibit 99.1): its own headline and opening sentence.
 * Public documents on sec.gov; filings never change, so each is read once.
 */
async function pressRelease(cik: number, accession: string, company: string): Promise<{ title: string; opening: string | null; url: string } | null> {
  const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;
  const index = await secGet(`${folder}/${accession}-index.htm`).catch(() => null);
  if (!index) return null;
  // The filing index lists each document with its type: take the first EX-99 exhibit that is a web page
  let href: string | null = null;
  for (const row of index.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    if (!/>\s*EX-99(?:\.1)?\s*</i.test(row)) continue;
    const m = /href="([^"]+\.html?)"/i.exec(row);
    if (m) {
      // Inline-XBRL exhibits are linked through SEC's viewer ("/ix?doc=/Archives/…"): read the document itself
      const path = m[1].replace(/^\/ix\?doc=/, "");
      href = path.startsWith("http") ? path : `https://www.sec.gov${path}`;
      break;
    }
  }
  if (!href) return null;
  const html = await secGet(href).catch(() => null);
  if (!html) return null;
  const lines = htmlText(html, true)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Skip EDGAR's own header lines (exhibit type, sequence number, file name)
  const content = lines.filter((l) => !/^(EX-?99(\.\d+)?|Exhibit\s+99(\.\d+)?|Document|\d+|.+\.html?|page \d+)$/i.test(l) && !/^[•·\-–—]$/.test(l));
  // Headline: the first line that reads like one ("… Announces …", "… Reports … Results"), else the first line of
  // text. This skips media contacts and logos' alt text that some releases put first.
  // Text lines only: not links, XBRL tags hidden in inline-XBRL exhibits, or single tokens
  const candidates = content.filter(
    (l) => l.length >= 12 && l.length <= 200 && /[a-z]/i.test(l) && /\s\S+\s/.test(l) && !/javascript|xbrl|https?:|www\.|fasb\.org|us-gaap|iso4217|#/i.test(l)
  );
  const HEADLINE = /\b(announc\w*|reports?|results|launch\w*|introduc\w*|complet\w*|appoint\w*|names?|declar\w*|unveil\w*|acquir\w*|agree\w*|transition|deliver\w*|expands?|signs?|prices?|updates?)\b/i;
  // No headline-like line: not a press release (e.g. an investor deck), so the item stays a plain filing
  // Company boilerplate ("About …", "Founded in …, we …"), safe-harbour text and contacts are never the headline
  const BOILERPLATE = /^(about|founded|forward-looking|safe harbor|contacts?|media|investor relations|press contact)\b|\b(we|our)\b/i;
  // A real release headline names the company ("NVIDIA Announces …", "Apple reports …"); decks and product sheets don't
  const name = company.split(/[\s.]/)[0].toLowerCase();
  const title = candidates.slice(0, 12).find((l) => HEADLINE.test(l) && !BOILERPLATE.test(l) && l.toLowerCase().includes(name));
  if (!title) return null;
  // Opening: the first long paragraph, without its dateline ("SANTA CLARA, Calif., Nov. 11, 2026 -- ")
  const para = content.find((l) => l.length >= 100 && l !== title);
  const opening = para
    ? firstSentence(
        para
          .replace(/^.{0,160}?\b(?:19|20)\d{2}\)?\s*(?:\/[^-–—]{0,60})?\s*(?:--|[-–—])+\s*/, "")
          .replace(/^[-–—\s]+/, "")
          .replace(/^\w/, (c) => c.toUpperCase())
      )
    : null;
  return { title: title.length > 160 ? `${title.slice(0, 157).replace(/\s+\S*$/, "")}…` : title, opening, url: href };
}

/** Each 8-K is read once: its press release if it has one, else its opening sentence */
const enriched = new Map<string, { title?: string; summary?: string; url?: string; pressRelease?: boolean }>();
async function enrich8K(cik: number, accession: string, url: string, company: string) {
  if (enriched.has(accession)) return enriched.get(accession)!;
  const pr = await pressRelease(cik, accession, company).catch(() => null);
  const value = pr
    ? { title: pr.title, summary: pr.opening ?? undefined, url: pr.url, pressRelease: true }
    : { summary: (await filingOpening(url).catch(() => null)) ?? undefined };
  enriched.set(accession, value);
  return value;
}

async function secFilings(): Promise<Omit<NewsItem, "priceThen" | "priceNow" | "changePct" | "priceSource">[]> {
  const since = Date.now() - 30 * 86_400_000;
  const out: (Omit<NewsItem, "priceThen" | "priceNow" | "changePct" | "priceSource"> & { cik: number; accession: string })[] = [];
  for (const [symbol, cik] of Object.entries(SEC_CIK)) {
    try {
      const res = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        // New filings come a few times a month per company: checking every 30 minutes is plenty
        next: { revalidate: 1800 },
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
        const accession = String(r.accessionNumber[i]);
        const tags = String(r.items?.[i] || "")
          .split(",")
          .map((x) => TAGS[x.trim()])
          .filter(Boolean);
        out.push({
          cik,
          accession,
          symbol,
          kind: "filing",
          form,
          tags: form.startsWith("10-K") ? ["Annual report"] : form === "10-Q" ? ["Quarterly report"] : tags,
          title: `${companyOf(symbol)}: ${FORMS[form].toLowerCase()}${items.length ? ` (${items.join(", ")})` : ""}`,
          source: "SEC",
          url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${r.primaryDocument?.[i] || ""}`,
          publishedAt: new Date(at).toISOString(),
        });
      }
    } catch {
      // one company failing leaves the others
    }
  }
  // Current reports are short and say what happened: use the attached press release, else the opening sentence.
  // Three at a time keeps well under SEC's 10 requests per second.
  const reports = out.filter((x) => x.form?.startsWith("8-K") || x.form === "6-K");
  for (let i = 0; i < reports.length; i += 3) {
    await Promise.all(
      reports.slice(i, i + 3).map(async (x) => {
        const e = await enrich8K(x.cik, x.accession, x.url, companyOf(x.symbol));
        if (e.title) x.title = `${companyOf(x.symbol)}: ${e.title}`;
        // A dateline cut can leave "Today announced …": put the company back in front
        if (e.summary) x.summary = /^today\b/i.test(e.summary) ? `${companyOf(x.symbol)} ${e.summary.replace(/^Today/, "today")}` : e.summary;
        if (e.url) x.url = e.url;
        if (e.pressRelease) x.pressRelease = true;
      })
    );
  }
  // Drop the lookup fields before the items leave the server
  return out.map((x) => {
    const item: Omit<NewsItem, "priceThen" | "priceNow" | "changePct" | "priceSource"> & { cik?: number; accession?: string } = { ...x };
    delete item.cik;
    delete item.accession;
    return item;
  });
}

/**
 * Some providers send UTF-8 text that was decoded as Windows-1252 on the way ("Nvidiaâ€™s" for "Nvidia's").
 * Re-decode those, then tidy the whitespace.
 */
function fixText(s: string): string {
  let t = s;
  if (/[âÃ][\u0080-ÿ‘-›€]/.test(t)) {
    const cp1252: Record<string, number> = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };
    const bytes = [...t].map((ch) => cp1252[ch] ?? ch.charCodeAt(0));
    if (bytes.every((b) => b < 256)) {
      const fixed = new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
      if (!fixed.includes("�")) t = fixed;
    }
  }
  return t.replace(/\s+/g, " ").trim();
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
      const list = (await res.json()) as { headline?: string; summary?: string; source?: string; url?: string; datetime?: number }[];
      const seen = new Set<string>();
      for (const n of Array.isArray(list) ? list : []) {
        const title = fixText(n.headline || "");
        if (!title || !n.url || !n.datetime || seen.has(title.toLowerCase())) continue;
        // Keep headlines that actually name the company (company feeds include market round-ups)
        if (NAME_RE[s.symbol] && !NAME_RE[s.symbol].test(title)) continue;
        seen.add(title.toLowerCase());
        // The provider's own teaser, kept to a couple of sentences; the article itself stays on the publisher's site
        const teaser = fixText(n.summary || "");
        const summary = teaser ? (teaser.length > 220 ? `${teaser.slice(0, 217).replace(/\s+\S*$/, "")}…` : teaser) : undefined;
        out.push({ symbol: s.symbol, kind: "news", title: title.slice(0, 200), summary, source: n.source || "news", url: n.url, publishedAt: new Date(n.datetime * 1000).toISOString() });
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
