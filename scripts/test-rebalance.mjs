// Unit checks for the rebalance planner (src/lib/rebalance.ts). No network, no wallet.
//   npm run test:rebalance
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/rebalance.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const file = join(mkdtempSync(join(tmpdir(), "maxx-rebalance-")), "rebalance.mjs");
writeFileSync(file, js);
const { planRebalance } = await import(pathToFileURL(file).href);

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "✅ " : "❌ ") + m);
  if (!c) fail++;
};
const N = (tokens, price = 200) => ({ symbol: "NVDAc", b20Address: "0xn", tokens, price });
const M = (tokens, price = 500) => ({ symbol: "MSFTc", b20Address: "0xm", tokens, price });
const T = (n, m) => [
  { symbol: "NVDAc", b20Address: "0xn", weightBps: n },
  { symbol: "MSFTc", b20Address: "0xm", weightBps: m },
];

let p = planRebalance([N(0.5)], T(5000, 5000));
ok(p.sells.length === 1 && Math.abs(p.sells[0].tokens - 0.25) < 1e-9, `100% NVDA -> 50/50: sell 0.25 NVDAc (got ${p.sells[0]?.tokens})`);
ok(p.buys.length === 1 && p.buys[0].symbol === "MSFTc" && p.buys[0].usd > 49 && p.buys[0].usd <= 50, `...and buy ~$49.7 MSFTc, capped by the sale proceeds (got ${p.buys[0]?.usd})`);

p = planRebalance([N(0.25), M(0.1)], T(5000, 5000));
ok(p.sells.length === 0 && p.buys.length === 0, "already on target: no trades");

p = planRebalance([{ symbol: "TSLAc", b20Address: "0xt", tokens: 0.123456, price: 300 }], [{ symbol: "NVDAc", b20Address: "0xn", weightBps: 10000 }]);
ok(p.sells[0]?.tokens === 0.123456, "stock outside the target: sells the exact holding (no dust)");

p = planRebalance([N(0.26), M(0.096)], T(5000, 5000));
ok(p.sells.length === 0 && p.buys.length === 0, "drift within the 2% band: hold");

p = planRebalance([], T(6000, 4000), { usdcAvailable: 20, addUsd: 20 });
ok(p.buys.length === 2 && Math.abs(p.buyUsd - 20) < 0.02, `new $20 split 60/40 (got ${p.buys.map((b) => `${b.symbol} ${b.usd}`).join(", ")})`);

// After step 1 the sale proceeds are USDC in the wallet: they must be reinvested, not ignored
p = planRebalance([N(0.25)], T(5000, 5000), { usdcAvailable: 49.7, addUsd: 49.7 });
ok(p.sells.length === 0 && p.buys.length === 1 && p.buys[0].usd > 49, `step 2 reinvests the proceeds (got ${p.buys[0]?.usd})`);

p = planRebalance([N(0.005)], T(5000, 5000));
ok(p.buys.every((b) => b.usd >= 0.5), "never proposes a buy under the $0.50 minimum");

console.log(fail ? `\n❌ ${fail} check(s) failed` : "\n✅ All rebalance checks passed");
process.exitCode = fail ? 1 : 0;
