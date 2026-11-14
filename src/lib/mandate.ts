/**
 * Reads a plain-language mandate ("AI and cloud, no Tesla, 3 stocks, equal weight") into explicit
 * parameters for the rule-based agent. Pure and dependency-free (unit-tested by scripts/test-agent.mjs).
 * English plus a few common Indonesian words.
 */

export interface ParsedMandate {
  /** theme ids that matched, in the order they appear in THEMES */
  themes: string[];
  /** symbols the user named explicitly */
  include: string[];
  /** symbols to leave out (named, or a theme after "no / without / except …") */
  exclude: string[];
  /** restrict the basket to the named themes / stocks ("only AI") */
  only: boolean;
  /** number of stocks requested (1–10) */
  count?: number;
  equalWeight: boolean;
  /** risk read from the words, if any ("safe", "aggressive") */
  riskHint?: "Conservative" | "Aggressive";
  prefersDiscount: boolean;
  prefersDividends: boolean;
  prefersLiquidity: boolean;
  /** only companies with a profit in their last annual report ("profitable") */
  prefersProfitable: boolean;
  /** favour fast revenue growth ("growth") */
  prefersGrowth: boolean;
  /** largest share of the money for any one stock, in percent ("max 30% per stock") */
  maxWeightPct?: number;
  /** share of the money to keep in USDC, in percent ("keep 20% in cash") */
  cashPct?: number;
  /** weights the user set for named stocks, in percent ("60% Apple 40% Microsoft") */
  weightsPct: Record<string, number>;
  /**
   * companies, funds or sectors asked for that are not among the 10 stocks MAXXAGENT supports.
   * `token`: the Coinbase tokenized stock that exists on Base for it (supported or not).
   */
  unavailable: { name: string; closest?: string; sector?: boolean; token?: string }[];
  /** human-readable lines: how the request was understood */
  notes: string[];
}

/** Ways people name each stock (lowercase, matched as whole words) */
export const STOCK_ALIASES: Record<string, string[]> = {
  NVDAc: ["nvdac", "nvda", "nvidia"],
  AAPLc: ["aaplc", "aapl", "apple", "iphone"],
  TSLAc: ["tslac", "tsla", "tesla"],
  MSFTc: ["msftc", "msft", "microsoft", "azure"],
  METAc: ["metac", "meta", "facebook", "instagram"],
  GOOGLc: ["googlc", "googl", "goog", "google", "alphabet"],
  AMZNc: ["amznc", "amzn", "amazon", "aws"],
  MSTRc: ["mstrc", "mstr", "microstrategy", "strategy inc"],
  SNDKc: ["sndkc", "sndk", "sandisk"],
  SPCXc: ["spcxc", "spcx", "spacex"],
};

export const THEMES: { id: string; label: string; words: string[]; symbols: string[] }[] = [
  { id: "ai", label: "AI", words: ["ai", "a.i.", "artificial intelligence", "gpu", "gpus", "compute", "data center", "datacenter", "llm", "machine learning"], symbols: ["NVDAc", "MSFTc", "GOOGLc", "METAc", "SNDKc"] },
  { id: "chips", label: "chips", words: ["chip", "chips", "semiconductor", "semiconductors", "semis", "semi"], symbols: ["NVDAc", "SNDKc"] },
  { id: "cloud", label: "cloud & software", words: ["cloud", "software", "saas", "enterprise"], symbols: ["MSFTc", "GOOGLc", "AMZNc"] },
  { id: "bigtech", label: "big tech", words: ["big tech", "bigtech", "mega cap", "megacap", "mega-cap", "faang", "mag7", "mag 7", "magnificent", "blue chip", "bluechip", "blue-chip", "tech giant", "tech giants", "big technology", "teknologi besar", "raksasa teknologi"], symbols: ["AAPLc", "MSFTc", "METAc", "GOOGLc", "AMZNc", "NVDAc"] },
  { id: "consumer", label: "consumer", words: ["consumer", "retail", "ecommerce", "e-commerce", "shopping"], symbols: ["AAPLc", "AMZNc", "TSLAc"] },
  { id: "social", label: "social & ads", words: ["social", "social media", "ads", "advertising"], symbols: ["METAc", "GOOGLc"] },
  { id: "ev", label: "EVs & robotics", words: ["ev", "evs", "electric car", "electric cars", "electric vehicle", "electric vehicles", "robotaxi", "robotics", "robots", "mobil listrik"], symbols: ["TSLAc"] },
  { id: "space", label: "space", words: ["space", "rocket", "rockets", "satellite", "satellites", "starlink", "aerospace", "orbital", "luar angkasa"], symbols: ["SPCXc"] },
  { id: "crypto", label: "crypto", words: ["crypto", "bitcoin", "btc", "kripto"], symbols: ["MSTRc"] },
  { id: "storage", label: "storage & memory", words: ["storage", "memory", "flash", "nand", "memori", "penyimpanan"], symbols: ["SNDKc"] },
  { id: "frontier", label: "frontier tech", words: ["frontier", "moonshot", "moonshots", "disruptive", "futuristic"], symbols: ["TSLAc", "SPCXc", "MSTRc"] },
  { id: "musk", label: "Elon Musk companies", words: ["elon", "musk", "elon musk"], symbols: ["TSLAc", "SPCXc"] },
];

/**
 * "Strategy" is also an ordinary word ("a growth strategy"), so it means Strategy Inc (MSTRc) only in a list
 * of companies ("Tesla, Amazon and Strategy") or next to stock words ("Strategy shares")
 */
const STRATEGY_RE = /(?:,|\band|\bdan|&|\bplus|\bor|\batau)\s+strategy\b(?!\s+(?:for|to|that|is|of|untuk|yang))|\bstrategy\s+(?:stock|stocks|shares|saham|token)\b/;

/**
 * Things people ask for that are not among the 10 stocks MAXXAGENT supports. `token` is the Coinbase
 * tokenized stock that exists on Base for it (see lib/unsupportedStocks); without one, Coinbase doesn't
 * issue it. A stock with a close equivalent among the 10 maps to that theme (AMD -> chips).
 * Ambiguous words are left out on purpose ("oracle" is also Chainlink's, "coin" is in "meme coin").
 */
export const NOT_AVAILABLE: { name: string; words: string[]; theme?: string; sector?: boolean; token?: string }[] = [
  { name: "AMD", words: ["amd"], theme: "chips", token: "AMDc" },
  { name: "Intel", words: ["intel", "intc"], theme: "chips", token: "INTCc" },
  { name: "TSMC", words: ["tsmc", "taiwan semiconductor"], theme: "chips" },
  { name: "Broadcom", words: ["broadcom", "avgo"], theme: "chips", token: "AVGOc" },
  { name: "ASML", words: ["asml"], theme: "chips" },
  { name: "Qualcomm", words: ["qualcomm", "qcom"], theme: "chips", token: "QCOMc" },
  { name: "Micron", words: ["micron"], theme: "storage", token: "MUc" },
  { name: "Palantir", words: ["palantir", "pltr"], theme: "ai", token: "PLTRc" },
  { name: "Salesforce", words: ["salesforce"], theme: "cloud", token: "CRMc" },
  { name: "Adobe", words: ["adobe"], theme: "cloud", token: "ADBEc" },
  { name: "Oracle", words: ["orcl", "oracle corp", "oracle corporation"], theme: "cloud", token: "ORCLc" },
  { name: "Netflix", words: ["netflix", "nflx"], token: "NFLXc" },
  { name: "Walmart", words: ["walmart"], theme: "consumer", token: "WMTc" },
  { name: "Costco", words: ["costco"], theme: "consumer" },
  { name: "Disney", words: ["disney"], token: "DISc" },
  { name: "Uber", words: ["uber"], token: "UBERc" },
  { name: "Berkshire Hathaway", words: ["berkshire"], token: "BRK.Bc" },
  { name: "JPMorgan", words: ["jpmorgan", "jp morgan", "jpm"], token: "JPMc" },
  { name: "Visa", words: ["visa"], token: "Vc" },
  { name: "Mastercard", words: ["mastercard"] },
  { name: "Eli Lilly", words: ["eli lilly", "lilly"], token: "LLYc" },
  { name: "Pfizer", words: ["pfizer"], token: "PFEc" },
  { name: "ExxonMobil", words: ["exxon", "exxonmobil"], token: "XOMc" },
  { name: "Boeing", words: ["boeing"], token: "BAc" },
  { name: "Robinhood", words: ["robinhood"], token: "HOODc" },
  { name: "Circle", words: ["crcl", "circle internet"], token: "CRCLc" },
  { name: "Take-Two", words: ["take-two", "take two", "ttwo", "rockstar games"], token: "TTWOc" },
  { name: "Alibaba", words: ["alibaba"] },
  { name: "index funds (S&P 500, Nasdaq 100)", sector: true, words: ["s&p 500", "s&p500", "sp500", "spy", "voo", "qqq", "nasdaq 100", "nasdaq-100"] },
  { name: "healthcare and pharma", sector: true, words: ["healthcare", "health care", "pharma", "pharmaceutical", "pharmaceuticals", "biotech", "kesehatan", "farmasi"] },
  { name: "banks and financials", sector: true, words: ["bank", "banks", "banking", "financials", "insurance", "perbankan"] },
  { name: "energy and oil", sector: true, words: ["energy", "oil", "minyak", "energi"] },
  { name: "gold and commodities", sector: true, words: ["gold", "silver", "commodities", "commodity", "emas"] },
  { name: "real estate", sector: true, words: ["real estate", "reit", "reits", "properti"] },
  { name: "bonds", sector: true, words: ["bond", "bonds", "treasuries", "t-bills", "obligasi"] },
  { name: "defense", sector: true, words: ["defense", "defence", "military"] },
];

const NEGATORS = ["no", "not", "without", "exclude", "excluding", "except", "avoid", "skip", "minus", "ex", "tanpa", "kecuali", "jangan", "selain", "bukan"];
const ONLY_WORDS = ["only", "just", "purely", "exclusively", "hanya", "saja"];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string) => new RegExp(`(^|[^a-z0-9])${esc(w)}($|[^a-z0-9])`);
const has = (text: string, words: string[]) => words.some((w) => wordRe(w).test(text));

/** Symbols and themes mentioned in a piece of text */
function mentions(text: string) {
  const symbols = Object.entries(STOCK_ALIASES).filter(([, a]) => has(text, a)).map(([s]) => s);
  if (!symbols.includes("MSTRc") && STRATEGY_RE.test(text)) symbols.push("MSTRc");
  const themes = THEMES.filter((t) => has(text, t.words)).map((t) => t.id);
  return { symbols, themes };
}

/**
 * Weights the user set for named stocks: "60% Apple 40% Microsoft", "half in Nvidia", "30% di Tesla",
 * "Nvidia at 40%". A percent written before a name belongs to that name; one written after a name is
 * used only when it isn't already taken.
 */
function explicitWeights(text: string): Record<string, number> {
  const t = text.replace(/\b(?:half|separuh|setengah)\b/g, "50%");
  const pct = "(\\d{1,3}(?:\\.\\d+)?)\\s*(?:%|percent|persen)";
  const out: Record<string, number> = {};
  const used = new Set<number>();
  for (const [sym, aliases] of Object.entries(STOCK_ALIASES)) {
    const names = aliases.map(esc).join("|");
    const before = new RegExp(`${pct}\\s*(?:(?:in|of|on|into|to|for|di|ke|untuk)\\s+)?(?:the\\s+)?(?:${names})(?![a-z0-9])`, "g");
    for (const m of t.matchAll(before)) {
      out[sym] = Number(m[1]);
      used.add(m.index! + m[0].indexOf(m[1]));
    }
  }
  for (const [sym, aliases] of Object.entries(STOCK_ALIASES)) {
    if (out[sym] !== undefined) continue;
    const names = aliases.map(esc).join("|");
    const after = new RegExp(`(?:^|[^a-z0-9])(?:${names})\\s*(?:at|:|=|-|sebesar)?\\s*${pct}`, "g");
    for (const m of t.matchAll(after)) {
      const at = m.index! + m[0].lastIndexOf(m[1]);
      if (used.has(at)) continue;
      out[sym] = Number(m[1]);
      used.add(at);
    }
  }
  for (const s of Object.keys(out)) if (!(out[s] > 0 && out[s] <= 100)) delete out[s];
  return out;
}

export function parseMandate(input: string): ParsedMandate {
  const text = ` ${(input || "").toLowerCase().replace(/\s+/g, " ")} `;
  const notes: string[] = [];

  // 1) Exclusions: "no tesla", "without crypto", "except NVDA and META", "avoid big tech"
  const exclude = new Set<string>();
  const excludedThemes = new Set<string>();
  const clauses: string[] = [];
  const negRe = new RegExp(`(?:^|[^a-z0-9])(?:${NEGATORS.map(esc).join("|")})\\s+([^.;!?]*?)(?=[.;!?]|\\s(?:but|with|prefer|plus|and also|dan|tapi|dengan)\\s|$)`, "g");
  // After a comma the negation only continues through bare names ("except nvda, meta and amzn");
  // "no tesla, ai stocks" stops at the comma
  const allNames = [...Object.values(STOCK_ALIASES).flat(), ...THEMES.flatMap((t) => t.words)];
  const bareName = (seg: string) => {
    const s = seg.trim().replace(/^(and|or|dan|atau)\s+/, "").trim();
    return s.split(/\s+(?:and|or|dan|atau)\s+/).every((part) => allNames.includes(part.trim()));
  };
  const negatedText: string[] = [];
  for (const m of text.matchAll(negRe)) {
    const segs = m[1].split(",");
    let end = 1;
    while (end < segs.length && bareName(segs[end])) end++;
    const clause = segs.slice(0, end).join(",");
    negatedText.push(clause);
    const found = mentions(clause);
    if (found.symbols.length || found.themes.length) {
      clauses.push(clause.trim());
      found.symbols.forEach((s) => exclude.add(s));
      found.themes.forEach((t) => {
        excludedThemes.add(t);
        THEMES.find((x) => x.id === t)!.symbols.forEach((s) => exclude.add(s));
      });
    }
  }
  // Strip only the negated names / theme words, so "no tesla" isn't read as asking for Tesla while the
  // rest of the clause ("…, 3 stocks, equal weight") still counts
  let positive = text;
  const negatedWords = [
    ...[...exclude].flatMap((s) => STOCK_ALIASES[s] || []),
    ...[...excludedThemes].flatMap((t) => THEMES.find((x) => x.id === t)!.words),
  ].sort((a, b) => b.length - a.length);
  for (const c of clauses) {
    let cleaned = ` ${c} `;
    for (const w of negatedWords) cleaned = cleaned.replace(new RegExp(`(^|[^a-z0-9])${esc(w)}(?=$|[^a-z0-9])`, "g"), "$1 ");
    positive = positive.split(c).join(cleaned);
  }

  // 2) What was asked for
  const found = mentions(positive);
  const include = found.symbols.filter((s) => !exclude.has(s));
  const themes = found.themes.filter((t) => !excludedThemes.has(t));
  // Weights set for named stocks (never for excluded ones); a stock with a weight is always included
  const weightsPct = explicitWeights(positive);
  for (const s of Object.keys(weightsPct)) {
    if (exclude.has(s)) delete weightsPct[s];
    else if (!include.includes(s)) include.push(s);
  }

  // 2b) Asked for, but not among the 10 supported stocks. "no netflix" is not a request: every negated
  // phrase (up to the next comma) is dropped first, including ones the exclusion pass above skipped
  let wanted = text;
  for (const c of negatedText) wanted = wanted.split(c).join(" ");
  wanted = wanted.replace(new RegExp(`(^|[^a-z0-9])(?:${NEGATORS.map(esc).join("|")})\\s+[^,.;!?]*`, "g"), "$1 ");
  const unavailable: ParsedMandate["unavailable"] = [];
  for (const u of NOT_AVAILABLE) {
    if (!has(wanted, u.words)) continue;
    const sub = u.theme && !excludedThemes.has(u.theme) ? THEMES.find((t) => t.id === u.theme) : undefined;
    unavailable.push({ name: u.name, closest: sub?.label, sector: u.sector, token: u.token });
    // A close equivalent stands in for it (AMD -> chips), unless that theme was excluded
    if (sub && !themes.includes(sub.id)) themes.push(sub.id);
  }
  themes.sort((a, b) => THEMES.findIndex((t) => t.id === a) - THEMES.findIndex((t) => t.id === b));
  const only = has(positive, ONLY_WORDS) && (themes.length > 0 || include.length > 0);

  // 2c) Limits: "keep 20% in cash" and "max 30% per stock" (cash first, so "up to 20% in usdc" is a reserve)
  const pct = "(\\d{1,3}(?:\\.\\d+)?)\\s*(?:%|percent|persen)";
  const cashWords = "(?:cash|usdc|stablecoins?|tunai|kas|reserve|cadangan)";
  let cashPct: number | undefined;
  const cashMatch =
    text.match(new RegExp(`${pct}\\s*(?:in\\s+|as\\s+|of\\s+|di\\s+|dalam\\s+|sebagai\\s+)?${cashWords}`)) ||
    text.match(new RegExp(`(?:keep|hold|leave|reserve|set aside|sisakan|simpan|sisihkan)\\s+${pct}`)) ||
    text.match(new RegExp(`${cashWords}\\s*(?:reserve\\s*)?(?:of\\s+)?${pct}`));
  if (cashMatch) {
    const v = Number(cashMatch[1]);
    if (v > 0 && v <= 90) cashPct = v;
  }
  let maxWeightPct: number | undefined;
  const maxMatch =
    text.match(new RegExp(`(?:max(?:imum)?|cap(?:ped)?(?:\\s+at)?|at most|no more than|not more than|up to|limit(?:ed)?(?:\\s+to)?|maks(?:imal|imum)?|paling banyak|tidak lebih dari)\\s*(?:of\\s+)?${pct}(?!\\s*(?:in\\s+|as\\s+|di\\s+)?${cashWords})`)) ||
    text.match(new RegExp(`(?:no|not|tidak ada)\\s+(?:single\\s+|one\\s+)?(?:stock|company|name|position|holding|saham)s?\\s+(?:over|above|more than|bigger than|exceeding|di atas|lebih dari)\\s+${pct}`)) ||
    text.match(new RegExp(`(?:cap|limit|batasi)\\s+(?:each|every|any|one|single|per|tiap|setiap)?\\s*(?:stock|company|name|position|holding|saham)s?\\s+(?:at|to|di|ke)\\s+${pct}`)) ||
    text.match(new RegExp(`${pct}\\s*(?:max(?:imum)?|cap|limit|maks(?:imal)?)(?:$|[^a-z])`));
  if (maxMatch) {
    const v = Number(maxMatch[1]);
    if (v > 0 && v < 100) maxWeightPct = Math.max(5, v);
  }

  // 3) Shape of the basket
  let count: number | undefined;
  const countMatch = positive.match(/(?:^|[^a-z0-9])(?:top\s+)?(\d{1,2})\s*(?:stocks?|names?|picks?|tickers?|companies|saham)(?:$|[^a-z0-9])/) || positive.match(/(?:^|[^a-z0-9])top\s+(\d{1,2})(?:$|[^a-z0-9])/);
  if (countMatch) count = Math.min(10, Math.max(1, Number(countMatch[1])));
  const equalWeight = has(positive, ["equal weight", "equal-weight", "equal weighted", "equal-weighted", "equally", "evenly", "same weight", "equal split", "sama rata", "rata rata", "bobot sama", "bobot rata", "sama besar"]);

  // 4) Preferences
  let riskHint: ParsedMandate["riskHint"];
  if (has(positive, ["safe", "safer", "low risk", "low-risk", "conservative", "defensive", "stable", "aman", "risiko rendah", "low volatility", "low-volatility", "less volatile", "volatilitas rendah", "recession-proof", "recession proof", "recession resistant", "downturn", "tahan resesi", "defensif"])) riskHint = "Conservative";
  else if (has(positive, ["aggressive", "high risk", "high-risk", "yolo", "max growth", "risiko tinggi", "agresif"])) riskHint = "Aggressive";
  const prefersDiscount = has(positive, ["cheap", "cheaper", "discount", "discounted", "below nav", "under nav", "undervalued", "bargain", "weekend", "gap", "murah", "diskon"]);
  const prefersDividends = has(positive, ["dividend", "dividends", "income", "yield", "dividen"]);
  const prefersLiquidity = has(positive, ["liquid", "liquidity", "low slippage", "deep pools", "likuid"]);
  const prefersProfitable = has(positive, ["profitable", "profitability", "profit", "profits", "earnings", "money-making", "untung", "laba", "menguntungkan"]);
  const prefersGrowth = has(positive, ["growth", "growing", "fast-growing", "fast growing", "high growth", "high-growth", "revenue growth", "tumbuh", "bertumbuh", "pertumbuhan"]);

  // 5) Explain
  for (const u of unavailable)
    notes.push(
      u.sector
        ? `None of the 10 stocks MAXXAGENT supports is in ${u.name}, so it was left out.`
        : `${u.name}${u.token ? ` (${u.token})` : ""} is not one of the 10 stocks MAXXAGENT supports${u.closest ? `: using the closest supported, ${u.closest}` : ", so it was left out"}.`
    );
  if (include.length) notes.push(`You named ${include.join(", ")}: always included.`);
  if (themes.length) notes.push(`Themes: ${themes.map((t) => THEMES.find((x) => x.id === t)!.label).join(", ")}${only ? " (only these)" : ""}.`);
  if (exclude.size) notes.push(`Left out: ${[...exclude].join(", ")} (from "${clauses.join('", "')}").`);
  if (count) notes.push(`${count} stock${count > 1 ? "s" : ""} requested.`);
  if (equalWeight) notes.push("Equal weights.");
  if (riskHint) notes.push(`Risk read from your words: ${riskHint.toLowerCase()}.`);
  if (prefersDiscount) notes.push("Prefers stocks trading below their NAV.");
  if (prefersDividends) notes.push("Prefers stocks with reinvested dividends.");
  if (prefersLiquidity) notes.push("Prefers the deepest liquidity (lower swap cost).");
  if (prefersProfitable) notes.push("Only companies with a profit in their last annual report (SEC 10-K).");
  if (prefersGrowth) notes.push("Prefers fast revenue growth (SEC 10-K, last fiscal year).");
  if (maxWeightPct) notes.push(`At most ${maxWeightPct}% of your money in any one stock.`);
  if (cashPct) notes.push(`Keep ${cashPct}% in USDC.`);
  if (Object.keys(weightsPct).length)
    notes.push(`Weights you set: ${Object.entries(weightsPct).map(([s, w]) => `${s} ${w}%`).join(", ")}.`);

  return {
    themes,
    include,
    exclude: [...exclude],
    only,
    count,
    equalWeight,
    riskHint,
    prefersDiscount,
    prefersDividends,
    prefersLiquidity,
    prefersProfitable,
    prefersGrowth,
    maxWeightPct,
    cashPct,
    weightsPct,
    unavailable,
    notes,
  };
}
