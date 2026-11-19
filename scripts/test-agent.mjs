// Unit checks for the mandate reader (src/lib/mandate.ts). No network.
//   npm run test:agent
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const dirA = mkdtempSync(join(tmpdir(), "maxx-mandate-"));
const dirB = mkdtempSync(join(tmpdir(), "maxx-weights-"));
const cleanup = () => {
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
};
let parseMandate, parseMandateSteps, capWeightsBps, roundWeightsBps;
try {
  const js = ts.transpileModule(readFileSync("src/lib/mandate.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const file = join(dirA, "mandate.mjs");
  writeFileSync(file, js);
  ({ parseMandate, parseMandateSteps } = await import(pathToFileURL(file).href));
  const wjs = ts.transpileModule(readFileSync("src/lib/weights.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const wfile = join(dirB, "weights.mjs");
  writeFileSync(wfile, wjs);
  ({ capWeightsBps, roundWeightsBps } = await import(pathToFileURL(wfile).href));
} finally {
  cleanup();
}

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "✅ " : "❌ ") + m);
  if (!c) fail++;
};
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

let m = parseMandate("AI and cloud, no Tesla, 3 stocks, equal weight");
ok(same(m.themes, ["ai", "cloud"]) && same(m.exclude, ["TSLAc"]) && m.count === 3 && m.equalWeight, `"AI and cloud, no Tesla, 3 stocks, equal weight" -> ${JSON.stringify({ t: m.themes, x: m.exclude, n: m.count, eq: m.equalWeight })}`);

m = parseMandate("I want a long-term growth strategy for my savings");
ok(!m.include.includes("MSTRc"), `"strategy" is not read as Strategy Inc (MSTRc): include=${JSON.stringify(m.include)}`);

m = parseMandate("Only space and crypto");
ok(m.only && same(m.themes, ["space", "crypto"]), `"Only space and crypto" -> only=${m.only}, themes=${JSON.stringify(m.themes)}`);

m = parseMandate("Big tech without crypto and avoid META");
ok(same(m.exclude, ["MSTRc", "METAc"]) && m.themes.includes("bigtech"), `exclusions with two negations -> ${JSON.stringify(m.exclude)}`);

m = parseMandate("NVDA, Apple and Microsoft, safe, cheap");
ok(same(m.include, ["NVDAc", "AAPLc", "MSFTc"]) && m.riskHint === "Conservative" && m.prefersDiscount, `names + risk + discount -> ${JSON.stringify({ i: m.include, r: m.riskHint, d: m.prefersDiscount })}`);

m = parseMandate("saham AI tanpa tesla, 4 saham, sama rata");
ok(m.themes.includes("ai") && same(m.exclude, ["TSLAc"]) && m.count === 4 && m.equalWeight, `Indonesian mandate -> ${JSON.stringify({ t: m.themes, x: m.exclude, n: m.count, eq: m.equalWeight })}`);

m = parseMandate("not too risky please, dividends");
ok(m.exclude.length === 0 && m.prefersDividends, `"not too risky" excludes nothing -> ${JSON.stringify(m.exclude)}`);

m = parseMandate("top 2 aggressive EV and robotics");
ok(m.count === 2 && m.riskHint === "Aggressive" && m.themes.includes("ev"), `"top 2 aggressive EV" -> ${JSON.stringify({ n: m.count, r: m.riskHint, t: m.themes })}`);

m = parseMandate("no tesla, ai stocks");
ok(same(m.exclude, ["TSLAc"]) && m.themes.includes("ai"), `"no tesla, ai stocks" keeps AI -> ${JSON.stringify({ x: m.exclude, t: m.themes })}`);

m = parseMandate("big tech except nvda, meta and amzn");
ok(same(m.exclude, ["NVDAc", "METAc", "AMZNc"]), `"except nvda, meta and amzn" -> ${JSON.stringify(m.exclude)}`);

// Limits, cash reserve and things that are not available
m = parseMandate("AI and Netflix, 3 stocks, max 30% per stock");
ok(m.maxWeightPct === 30 && m.count === 3 && m.unavailable.length === 1 && m.unavailable[0].name === "Netflix" && !m.unavailable[0].closest, `cap + unavailable -> ${JSON.stringify({ cap: m.maxWeightPct, n: m.count, u: m.unavailable })}`);

m = parseMandate("big tech, max 20% per stock, keep 10% in USDC");
ok(m.maxWeightPct === 20 && m.cashPct === 10, `cap and cash read separately -> ${JSON.stringify({ cap: m.maxWeightPct, cash: m.cashPct })}`);

m = parseMandate("up to 15% in cash, cap each stock at 25%");
ok(m.cashPct === 15 && m.maxWeightPct === 25, `"up to 15% in cash" is a reserve, not a cap -> ${JSON.stringify({ cap: m.maxWeightPct, cash: m.cashPct })}`);

m = parseMandate("saham AI, maksimal 30% per saham, sisakan 20% di usdc");
ok(m.maxWeightPct === 30 && m.cashPct === 20, `Indonesian limits -> ${JSON.stringify({ cap: m.maxWeightPct, cash: m.cashPct })}`);

for (const [text, cap, cash] of [
  ["Chips and cloud plus Palantir, nothing above 25%, keep 15% in cash", 25, 15],
  ["tech-heavy, nothing above 40%", 40, undefined],
  ["AI stocks, none of them over 30%", 30, undefined],
  ["big tech, each at most 20%", 20, undefined],
  ["cloud names, under 25% each", 25, undefined],
  ["saham AI, tidak ada yang lebih dari 30%", 30, undefined],
]) {
  m = parseMandate(text);
  ok(m.maxWeightPct === cap && m.cashPct === cash, `cap phrasing "${text}" -> ${JSON.stringify({ cap: m.maxWeightPct, cash: m.cashPct })}`);
}
// A ceiling on cash is not a per-stock limit
for (const text of ["AI stocks, nothing more than 10% in cash", "big tech, each under 5% in usdc"]) {
  m = parseMandate(text);
  ok(m.maxWeightPct === undefined, `a cash ceiling is not a stock limit: "${text}" -> ${JSON.stringify({ cap: m.maxWeightPct, cash: m.cashPct })}`);
}

m = parseMandate("AMD and Intel only");
ok(m.only && m.themes.includes("chips") && m.unavailable.every((u) => u.closest === "chips"), `AMD/Intel -> closest available chips -> ${JSON.stringify({ t: m.themes, u: m.unavailable })}`);

m = parseMandate("AI, no tesla, no netflix");
ok(m.unavailable.length === 0 && m.exclude.includes("TSLAc"), `"no netflix" is not a request -> ${JSON.stringify(m.unavailable)}`);

m = parseMandate("healthcare and banks");
ok(m.unavailable.length === 2 && m.unavailable.every((u) => u.sector) && m.themes.length === 0, `sectors with no tokenized stock -> ${JSON.stringify(m.unavailable)}`);

m = parseMandate("prefer the Chainlink oracle with fresh data, top 3 stocks below nav");
ok(m.unavailable.length === 0 && m.maxWeightPct === undefined && m.cashPct === undefined, `no false positives from "oracle" or "3 stocks" -> ${JSON.stringify({ u: m.unavailable, cap: m.maxWeightPct, cash: m.cashPct })}`);

// Stocks that exist on Base but aren't supported name their Coinbase token; ones Coinbase doesn't issue don't
m = parseMandate("AI and Netflix, 3 stocks, max 30% per stock");
const nf = m.unavailable.find((u) => u.name === "Netflix");
ok(nf && nf.token === "NFLXc" && !m.notes.some((n) => /not available as a tokenized stock/.test(n)), `Netflix -> token ${nf?.token}, note "${m.notes.find((n) => /Netflix/.test(n))}"`);
m = parseMandate("Costco and Apple");
ok(m.unavailable.find((u) => u.name === "Costco")?.token === undefined, "Costco has no Coinbase token");
m = parseMandate("no netflix, big tech");
ok(!m.unavailable.length, `"no netflix" is not a request -> ${JSON.stringify(m.unavailable)}`);

// Fundamentals preferences
m = parseMandate("profitable big tech with strong revenue growth");
ok(m.prefersProfitable && m.prefersGrowth && m.themes.includes("bigtech"), `profitable + growth -> ${JSON.stringify({ p: m.prefersProfitable, g: m.prefersGrowth, t: m.themes })}`);
m = parseMandate("saham AI yang untung dan tumbuh cepat");
ok(m.prefersProfitable && m.prefersGrowth, "Indonesian: untung + tumbuh");
m = parseMandate("AI and cloud, 3 stocks");
ok(!m.prefersProfitable && !m.prefersGrowth, "no fundamentals filter unless asked");

// Wider vocabulary (found by running 40 realistic requests)
m = parseMandate("Tesla, Amazon and Strategy");
ok(same(m.include, ["TSLAc", "AMZNc", "MSTRc"]), `Strategy in a list of companies -> ${JSON.stringify(m.include)}`);
m = parseMandate("Elon Musk companies");
ok(m.themes.includes("musk"), "Elon Musk companies -> musk theme");
m = parseMandate("low volatility, keep 20% cash");
ok(m.riskHint === "Conservative" && m.cashPct === 20, "low volatility -> conservative");
m = parseMandate("saham teknologi besar, 4 saham, sama rata");
ok(m.themes.includes("bigtech") && m.count === 4 && m.equalWeight, "teknologi besar -> big tech");
m = parseMandate("Apple, Google dan Nvidia, bobot sama");
ok(m.equalWeight && m.include.length === 3, "bobot sama -> equal weight");

// Weights the user sets
m = parseMandate("60% Apple 40% Microsoft");
ok(m.weightsPct.AAPLc === 60 && m.weightsPct.MSFTc === 40, `60% Apple 40% Microsoft -> ${JSON.stringify(m.weightsPct)}`);
m = parseMandate("put half in Nvidia and the rest spread out");
ok(m.weightsPct.NVDAc === 50, "half in Nvidia -> 50%");
m = parseMandate("30% di Tesla dan 20% di Amazon");
ok(m.weightsPct.TSLAc === 30 && m.weightsPct.AMZNc === 20, "Indonesian weights");
m = parseMandate("AI and Netflix, 3 stocks, max 30% per stock");
ok(!Object.keys(m.weightsPct).length && m.maxWeightPct === 30, "a limit is not read as a weight");
m = parseMandate("no tesla 30% cash");
ok(!Object.keys(m.weightsPct).length && m.cashPct === 30, "cash is not read as a weight");
// Regressions from the code review
m = parseMandate("Apple 60% Microsoft 40%");
ok(m.weightsPct.AAPLc === 60 && m.weightsPct.MSFTc === 40, `name-first weights stay with their names -> ${JSON.stringify(m.weightsPct)}`);
m = parseMandate("nvidia at 40% tesla at 60%");
ok(m.weightsPct.NVDAc === 40 && m.weightsPct.TSLAc === 60, `"X at N%" pairs -> ${JSON.stringify(m.weightsPct)}`);
m = parseMandate("max 30% in tesla");
ok(!Object.keys(m.weightsPct).length && m.maxWeightPct === 30, `a cap before a name is not a weight -> ${JSON.stringify(m.weightsPct)}`);
m = parseMandate("hold 40% nvidia and 60% apple");
ok(m.cashPct === undefined && m.weightsPct.NVDAc === 40 && m.weightsPct.AAPLc === 60, `"hold 40% nvidia" is a weight, not cash -> cash=${m.cashPct} ${JSON.stringify(m.weightsPct)}`);
m = parseMandate("Apple and Microsoft, 20% in cash");
ok(!Object.keys(m.weightsPct).length && m.cashPct === 20, "cash after names is not a weight");
m = parseMandate("aggressive picks to buy the downturn");
ok(m.riskHint === "Aggressive", `"buy the downturn" stays aggressive -> ${m.riskHint}`);
m = parseMandate("Build me a safe basket, strategy: long term");
ok(!m.include.includes("MSTRc"), "\"strategy:\" in a sentence is not Strategy Inc");
m = parseMandate("low risk and strategy-driven");
ok(!m.include.includes("MSTRc"), "\"strategy-driven\" is not Strategy Inc");
m = parseMandate("Strategy shares and Tesla");
ok(m.include.includes("MSTRc"), "\"Strategy shares\" is Strategy Inc");

// Pass 8 NLP regressions
m = parseMandate("tanpa tesla dan meta");
ok(
  m.exclude.includes("TSLAc") && m.exclude.includes("METAc") && !m.include.includes("METAc"),
  `chained Indonesian negation excludes both -> excl=${JSON.stringify(m.exclude)}`,
);
m = parseMandate("no tesla, no meta");
ok(
  m.exclude.includes("TSLAc") && m.exclude.includes("METAc") && !m.include.includes("METAc"),
  `repeated English negation excludes both -> excl=${JSON.stringify(m.exclude)}`,
);
m = parseMandate("cap Apple at 25%");
ok(
  !Object.keys(m.weightsPct).length && m.include.includes("AAPLc"),
  `"cap Apple at 25%" is not read as an exact weight -> max=${m.maxWeightPct} w=${JSON.stringify(m.weightsPct)}`,
);
m = parseMandate("under 30% in Tesla");
ok(
  !Object.keys(m.weightsPct).length && m.include.includes("TSLAc"),
  `"under 30% in Tesla" is not read as an exact weight -> w=${JSON.stringify(m.weightsPct)}`,
);
m = parseMandate("Apple 30% cap");
ok(
  !Object.keys(m.weightsPct).length && m.include.includes("AAPLc"),
  `"Apple 30% cap" is not read as an exact weight -> w=${JSON.stringify(m.weightsPct)}`,
);
m = parseMandate("saham AI, di bawah 25% per saham");
ok(
  m.maxWeightPct === 25 && !Object.keys(m.weightsPct).length,
  `"di bawah 25% per saham" sets maxWeightPct=25 -> max=${m.maxWeightPct}`,
);
m = parseMandate("20% max cash");
ok(
  m.cashPct === 20 && !Object.keys(m.weightsPct).length,
  `"20% max cash" parses cashPct -> cash=${m.cashPct} w=${JSON.stringify(m.weightsPct)}`,
);
m = parseMandate("keep half in cash");
ok(m.cashPct === 50, `"keep half in cash" -> cash=${m.cashPct}`);
m = parseMandate("24/7 stocks, AI");
ok(m.count === undefined && m.themes.includes("ai"), `"24/7 stocks" does not set count=7 -> ${m.count}`);
m = parseMandate("don't include Tesla");
ok(
  m.exclude.includes("TSLAc") && !m.include.includes("TSLAc"),
  `"don't include Tesla" excludes TSLAc -> excl=${JSON.stringify(m.exclude)}`,
);
m = parseMandate("no tesla, ai, 3 stocks");
ok(
  m.exclude.includes("TSLAc") && !m.include.includes("TSLAc") && m.themes.includes("ai") && m.count === 3,
  `"no tesla, ai, 3 stocks" excludes TSLAc without blocking themes/count -> ${JSON.stringify(m)}`,
);

// Weight capping
let w = capWeightsBps([5000, 3000, 2000], 4000);
ok(w && w.reduce((a, b) => a + b, 0) === 10000 && Math.max(...w) <= 4000 && w[1] > w[2], `cap 40%: [50,30,20] -> ${JSON.stringify(w)}`);
w = capWeightsBps([3400, 3300, 3300], 3334);
ok(w && w.reduce((a, b) => a + b, 0) === 10000 && Math.max(...w) <= 3334, `tight cap (3 x 33.34%) still sums to 100% -> ${JSON.stringify(w)}`);
ok(capWeightsBps([5000, 5000], 4000) === null, "an impossible cap (2 x 40%) is refused, never broken");
w = roundWeightsBps([1, 1, 1]);
ok(w && w.reduce((a, b) => a + b, 0) === 10000, `rounding thirds sums to 10000 -> ${JSON.stringify(w)}`);

// Pass 9 NLP regressions
m = parseMandate("no tesla and buy netflix");
ok(
  m.exclude.includes("TSLAc") && m.unavailable.some((u) => u.token === "NFLXc"),
  `"no tesla and buy netflix" keeps unavailable Netflix -> unavail=${JSON.stringify(m.unavailable.map((u) => u.token))}`,
);
m = parseMandate("AI stocks with no more than 25% per stock and Palantir");
ok(
  m.maxWeightPct === 25 && m.unavailable.some((u) => u.token === "PLTRc"),
  `quantifier cap phrase does not wipe unavailable Palantir -> max=${m.maxWeightPct} unavail=${JSON.stringify(m.unavailable.map((u) => u.token))}`,
);
m = parseMandate("keep 80% in stocks, buy Apple and Nvidia");
ok(
  m.cashPct === undefined && m.include.includes("AAPLc") && m.include.includes("NVDAc"),
  `"keep 80% in stocks" is not misread as cash -> cash=${m.cashPct}`,
);
m = parseMandate("no aggressive stocks, buy Nvidia");
ok(
  m.riskHint !== "Aggressive" && m.include.includes("NVDAc"),
  `negated risk hint is suppressed -> risk=${m.riskHint}`,
);
m = parseMandate("cap Strategy Inc at 25% and buy Nvidia");
ok(
  m.weightsPct.MSTRc === undefined && m.include.includes("NVDAc"),
  `multi-word CAP_BEFORE matches "cap Strategy Inc at 25%" -> w=${JSON.stringify(m.weightsPct)}`,
);

// Pass 10 NLP regressions
m = parseMandate("AI stocks with no more than 25% per stock and no tesla");
ok(
  m.maxWeightPct === 25 && m.exclude.includes("TSLAc") && !m.include.includes("TSLAc"),
  `"no more than 25% ... and no tesla" keeps trailing exclusion -> excl=${JSON.stringify(m.exclude)}`,
);
m = parseMandate("keep 60% for Apple and 40% for Microsoft");
ok(
  m.cashPct === undefined && m.weightsPct.AAPLc === 60 && m.weightsPct.MSFTc === 40,
  `"keep 60% for Apple" is a stock weight, not cash -> cash=${m.cashPct} w=${JSON.stringify(m.weightsPct)}`,
);
m = parseMandate("hold 60% for stocks, buy Nvidia and Apple");
ok(
  m.cashPct === undefined && m.include.includes("NVDAc") && m.include.includes("AAPLc"),
  `"hold 60% for stocks" is not misread as cash -> cash=${m.cashPct}`,
);
m = parseMandate("no safe stocks, buy aggressive AI");
ok(
  m.riskHint === "Aggressive" && m.themes.includes("ai"),
  `negated conservative term does not override aggressive hint -> risk=${m.riskHint}`,
);

// Stage 3 follow-up mandate merging
m = parseMandateSteps(["AI and cloud, 4 stocks, keep 20% in cash", "no Tesla, max 25% per stock"]);
ok(
  m.themes.includes("ai") && m.themes.includes("cloud") && m.count === 4 && m.cashPct === 20 && m.maxWeightPct === 25 && m.exclude.includes("TSLAc"),
  `follow-up preserves themes/count/cash and adds cap+exclude -> ${JSON.stringify({ themes: m.themes, c: m.count, cash: m.cashPct, max: m.maxWeightPct, excl: m.exclude })}`,
);
m = parseMandateSteps(["60% Apple 40% Microsoft, no Tesla", "equal weight, include Tesla, 0% cash", "remove cap"]);
ok(
  m.equalWeight && !Object.keys(m.weightsPct).length && m.include.includes("TSLAc") && !m.exclude.includes("TSLAc") && m.cashPct === undefined && m.maxWeightPct === undefined,
  `follow-up equal weight resets custom weights, restores TSLA, clears cash/cap -> ${JSON.stringify({ eq: m.equalWeight, w: m.weightsPct, incl: m.include, excl: m.exclude })}`,
);
m = parseMandateSteps(["AI and Netflix, 3 stocks, max 30% per stock", "no cap, keep 15% in usdc, prefer below nav"]);
ok(
  m.maxWeightPct === undefined && m.cashPct === 15 && m.prefersDiscount && m.unavailable.some((u) => u.token === "NFLXc") && m.count === 3,
  `follow-up removes cap cleanly while keeping unavailable & adding cash+discount -> ${JSON.stringify({ max: m.maxWeightPct, cash: m.cashPct, disc: m.prefersDiscount })}`,
);

console.log(fail ?`\n❌ ${fail} check(s) failed` : "\n✅ All mandate checks passed");
process.exitCode = fail ? 1 : 0;
