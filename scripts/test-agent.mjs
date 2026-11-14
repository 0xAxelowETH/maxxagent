// Unit checks for the mandate reader (src/lib/mandate.ts). No network.
//   npm run test:agent
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/mandate.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const file = join(mkdtempSync(join(tmpdir(), "maxx-mandate-")), "mandate.mjs");
writeFileSync(file, js);
const { parseMandate } = await import(pathToFileURL(file).href);
const wjs = ts.transpileModule(readFileSync("src/lib/weights.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const wfile = join(mkdtempSync(join(tmpdir(), "maxx-weights-")), "weights.mjs");
writeFileSync(wfile, wjs);
const { capWeightsBps, roundWeightsBps } = await import(pathToFileURL(wfile).href);

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

// Weight capping
let w = capWeightsBps([5000, 3000, 2000], 4000);
ok(w && w.reduce((a, b) => a + b, 0) === 10000 && Math.max(...w) <= 4000 && w[1] > w[2], `cap 40%: [50,30,20] -> ${JSON.stringify(w)}`);
w = capWeightsBps([3400, 3300, 3300], 3334);
ok(w && w.reduce((a, b) => a + b, 0) === 10000 && Math.max(...w) <= 3334, `tight cap (3 x 33.34%) still sums to 100% -> ${JSON.stringify(w)}`);
ok(capWeightsBps([5000, 5000], 4000) === null, "an impossible cap (2 x 40%) is refused, never broken");
w = roundWeightsBps([1, 1, 1]);
ok(w && w.reduce((a, b) => a + b, 0) === 10000, `rounding thirds sums to 10000 -> ${JSON.stringify(w)}`);

console.log(fail ?`\n❌ ${fail} check(s) failed` : "\n✅ All mandate checks passed");
process.exitCode = fail ? 1 : 0;
