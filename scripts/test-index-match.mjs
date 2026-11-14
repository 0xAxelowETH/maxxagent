// Unit checks for matching onchain buys to published indexes (src/lib/indexMatch.ts). No network, no wallet.
//   npm run test:indexmatch
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/indexMatch.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const file = join(mkdtempSync(join(tmpdir(), "maxx-indexmatch-")), "indexMatch.mjs");
writeFileSync(file, js);
const { matchIndexBuys } = await import(pathToFileURL(file).href);

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "✅ " : "❌ ") + m);
  if (!c) fail++;
};
const TRIO = { id: 1, constituents: [{ symbol: "GOOGLc", weightBps: 3400 }, { symbol: "MSFTc", weightBps: 3300 }, { symbol: "NVDAc", weightBps: 3300 }] };
const FRNT = { id: 3, constituents: [{ symbol: "SPCXc", weightBps: 3000 }, { symbol: "TSLAc", weightBps: 2800 }, { symbol: "MSTRc", weightBps: 2200 }, { symbol: "NVDAc", weightBps: 2000 }] };
const SOLO = { id: 9, constituents: [{ symbol: "NVDAc", weightBps: 10000 }] };
const buy = (wallet, time, symbol, usd) => ({ wallet, time, side: "buy", symbol, usd });
const ALL = [TRIO, FRNT, SOLO];

let r = matchIndexBuys([buy("a", 100, "GOOGLc", 1.05), buy("a", 104, "MSFTc", 1.02), buy("a", 109, "NVDAc", 1.03)], ALL);
ok(r.length === 1 && r[0].id === 1 && r[0].buys === 1 && Math.abs(r[0].volumeUsd - 3.1) < 0.01 && r[0].wallets === 1, "a $3.10 buy of the trio counts once for index #1");

r = matchIndexBuys([buy("a", 100, "GOOGLc", 1.05), buy("a", 104, "MSFTc", 1.02)], ALL);
ok(r.length === 0, "a basket missing one stock does not count");

r = matchIndexBuys([buy("a", 100, "GOOGLc", 5), buy("a", 104, "MSFTc", 1), buy("a", 109, "NVDAc", 1)], ALL);
ok(r.length === 0, "the right stocks in the wrong proportions do not count");

r = matchIndexBuys([buy("a", 100, "GOOGLc", 3.4), buy("a", 104, "MSFTc", 3.3), buy("a", 2000, "NVDAc", 3.3)], ALL);
ok(r.length === 0, "legs far apart in time are not one basket");

r = matchIndexBuys([buy("a", 100, "GOOGLc", 3.4), buy("b", 104, "MSFTc", 3.3), buy("c", 109, "NVDAc", 3.3)], ALL);
ok(r.length === 0, "different wallets are never combined");

r = matchIndexBuys([buy("a", 100, "NVDAc", 10)], ALL);
ok(r.length === 0, "a single-stock buy never counts as an index buy");

r = matchIndexBuys(
  [
    buy("a", 100, "GOOGLc", 3.4), buy("a", 104, "MSFTc", 3.3), buy("a", 109, "NVDAc", 3.3),
    buy("a", 120, "GOOGLc", 6.8), buy("a", 124, "MSFTc", 6.6), buy("a", 129, "NVDAc", 6.6),
    buy("b", 500, "SPCXc", 30), buy("b", 505, "TSLAc", 28), buy("b", 511, "MSTRc", 22), buy("b", 516, "NVDAc", 20),
    { wallet: "b", time: 600, side: "sell", symbol: "NVDAc", usd: 20 },
  ],
  ALL
);
const one = r.find((x) => x.id === 1);
const three = r.find((x) => x.id === 3);
ok(one?.buys === 2 && Math.abs(one.volumeUsd - 30) < 0.01 && one.wallets === 1, "two back-to-back buys of the same index by one wallet = 2 buys, 1 wallet");
ok(three?.buys === 1 && three.volumeUsd === 100 && r[0].id === 3, "another wallet's 4-stock buy matches #3, and the list is sorted by volume");

const TWIN = { id: 7, constituents: [...TRIO.constituents] };
r = matchIndexBuys([buy("a", 100, "GOOGLc", 3.4), buy("a", 104, "MSFTc", 3.3), buy("a", 109, "NVDAc", 3.3)], [TWIN, TRIO]);
ok(r.length === 1 && r[0].id === 1, "two indexes with identical weights: the older one keeps the credit");

console.log(fail ? `\n❌ ${fail} check(s) failed` : "\n✅ All index-match checks passed");
process.exit(fail ? 1 : 0);
