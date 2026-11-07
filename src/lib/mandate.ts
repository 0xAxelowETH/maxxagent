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
  { id: "bigtech", label: "big tech", words: ["big tech", "bigtech", "mega cap", "megacap", "mega-cap", "faang", "mag7", "mag 7", "magnificent", "blue chip", "bluechip", "blue-chip"], symbols: ["AAPLc", "MSFTc", "METAc", "GOOGLc", "AMZNc", "NVDAc"] },
  { id: "consumer", label: "consumer", words: ["consumer", "retail", "ecommerce", "e-commerce", "shopping"], symbols: ["AAPLc", "AMZNc", "TSLAc"] },
  { id: "social", label: "social & ads", words: ["social", "social media", "ads", "advertising"], symbols: ["METAc", "GOOGLc"] },
  { id: "ev", label: "EVs & robotics", words: ["ev", "evs", "electric car", "electric cars", "electric vehicle", "electric vehicles", "robotaxi", "robotics", "robots", "mobil listrik"], symbols: ["TSLAc"] },
  { id: "space", label: "space", words: ["space", "rocket", "rockets", "satellite", "satellites", "starlink", "aerospace", "orbital", "luar angkasa"], symbols: ["SPCXc"] },
  { id: "crypto", label: "crypto", words: ["crypto", "bitcoin", "btc", "kripto"], symbols: ["MSTRc"] },
  { id: "storage", label: "storage & memory", words: ["storage", "memory", "flash", "nand"], symbols: ["SNDKc"] },
  { id: "frontier", label: "frontier tech", words: ["frontier", "moonshot", "moonshots", "disruptive", "futuristic"], symbols: ["TSLAc", "SPCXc", "MSTRc"] },
];

const NEGATORS = ["no", "not", "without", "exclude", "excluding", "except", "avoid", "skip", "minus", "ex", "tanpa", "kecuali", "jangan", "selain", "bukan"];
const ONLY_WORDS = ["only", "just", "purely", "exclusively", "hanya", "saja"];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string) => new RegExp(`(^|[^a-z0-9])${esc(w)}($|[^a-z0-9])`);
const has = (text: string, words: string[]) => words.some((w) => wordRe(w).test(text));

/** Symbols and themes mentioned in a piece of text */
function mentions(text: string) {
  const symbols = Object.entries(STOCK_ALIASES).filter(([, a]) => has(text, a)).map(([s]) => s);
  const themes = THEMES.filter((t) => has(text, t.words)).map((t) => t.id);
  return { symbols, themes };
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
  for (const m of text.matchAll(negRe)) {
    const segs = m[1].split(",");
    let end = 1;
    while (end < segs.length && bareName(segs[end])) end++;
    const clause = segs.slice(0, end).join(",");
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
  const only = has(positive, ONLY_WORDS) && (themes.length > 0 || include.length > 0);

  // 3) Shape of the basket
  let count: number | undefined;
  const countMatch = positive.match(/(?:^|[^a-z0-9])(?:top\s+)?(\d{1,2})\s*(?:stocks?|names?|picks?|tickers?|companies|saham)(?:$|[^a-z0-9])/) || positive.match(/(?:^|[^a-z0-9])top\s+(\d{1,2})(?:$|[^a-z0-9])/);
  if (countMatch) count = Math.min(10, Math.max(1, Number(countMatch[1])));
  const equalWeight = has(positive, ["equal weight", "equal-weight", "equal weighted", "equal-weighted", "equally", "evenly", "same weight", "equal split", "sama rata", "rata rata"]);

  // 4) Preferences
  let riskHint: ParsedMandate["riskHint"];
  if (has(positive, ["safe", "safer", "low risk", "low-risk", "conservative", "defensive", "stable", "aman", "risiko rendah"])) riskHint = "Conservative";
  else if (has(positive, ["aggressive", "high risk", "high-risk", "yolo", "max growth", "risiko tinggi", "agresif"])) riskHint = "Aggressive";
  const prefersDiscount = has(positive, ["cheap", "cheaper", "discount", "discounted", "below nav", "under nav", "undervalued", "bargain", "weekend", "gap", "murah", "diskon"]);
  const prefersDividends = has(positive, ["dividend", "dividends", "income", "yield", "dividen"]);
  const prefersLiquidity = has(positive, ["liquid", "liquidity", "low slippage", "deep pools", "likuid"]);

  // 5) Explain
  if (include.length) notes.push(`You named ${include.join(", ")}: always included.`);
  if (themes.length) notes.push(`Themes: ${themes.map((t) => THEMES.find((x) => x.id === t)!.label).join(", ")}${only ? " (only these)" : ""}.`);
  if (exclude.size) notes.push(`Left out: ${[...exclude].join(", ")} (from "${clauses.join('", "')}").`);
  if (count) notes.push(`${count} stock${count > 1 ? "s" : ""} requested.`);
  if (equalWeight) notes.push("Equal weights.");
  if (riskHint) notes.push(`Risk read from your words: ${riskHint.toLowerCase()}.`);
  if (prefersDiscount) notes.push("Prefers stocks trading below their NAV.");
  if (prefersDividends) notes.push("Prefers stocks with reinvested dividends.");
  if (prefersLiquidity) notes.push("Prefers the deepest liquidity (lower swap cost).");

  return { themes, include, exclude: [...exclude], only, count, equalWeight, riskHint, prefersDiscount, prefersDividends, prefersLiquidity, notes };
}
