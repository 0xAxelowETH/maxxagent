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

console.log(fail ?`\n❌ ${fail} check(s) failed` : "\n✅ All mandate checks passed");
process.exitCode = fail ? 1 : 0;
