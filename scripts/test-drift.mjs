// Unit checks for the saved-target drift (src/lib/drift.ts). No network, no wallet.
//   npm run test:drift
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/drift.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const file = join(mkdtempSync(join(tmpdir(), "maxx-drift-")), "drift.mjs");
writeFileSync(file, js);
const { computeDrift, parseSavedTarget } = await import(pathToFileURL(file).href);

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "✅ " : "❌ ") + m);
  if (!c) fail++;
};
const near = (a, b) => Math.abs(a - b) < 1e-6;
const T = [{ symbol: "NVDAc", weightBps: 5000 }, { symbol: "MSFTc", weightBps: 5000 }];

let d = computeDrift([{ symbol: "NVDAc", usd: 50 }, { symbol: "MSFTc", usd: 50 }], T);
ok(d && near(d.driftPct, 0) && d.over.length === 0 && d.under.length === 0, "exactly on target: drift 0%");

d = computeDrift([{ symbol: "NVDAc", usd: 60 }, { symbol: "MSFTc", usd: 40 }], T);
ok(d && near(d.driftPct, 10) && d.over[0].symbol === "NVDAc" && near(d.over[0].diffPct, 10) && d.under[0].symbol === "MSFTc", "60/40 against 50/50: drift 10%, NVDAc over, MSFTc under");

d = computeDrift([{ symbol: "NVDAc", usd: 100 }], T);
ok(d && near(d.driftPct, 50) && d.under[0].symbol === "MSFTc" && near(d.under[0].currentPct, 0), "holding only one of two targets: drift 50%");

d = computeDrift([{ symbol: "TSLAc", usd: 100 }], T);
ok(d && near(d.driftPct, 100) && d.over[0].symbol === "TSLAc" && d.under.length === 2, "holding only a stock outside the target: drift 100%");

d = computeDrift([{ symbol: "NVDAc", usd: 45 }, { symbol: "MSFTc", usd: 45 }, { symbol: "TSLAc", usd: 10 }], T);
ok(d && near(d.driftPct, 10) && d.over[0].symbol === "TSLAc" && near(d.totalUsd, 100), "a 10% position outside the target counts as 10% drift");

ok(computeDrift([], T) === null && computeDrift([{ symbol: "NVDAc", usd: 0 }], T) === null, "no holdings: no drift to report");
ok(computeDrift([{ symbol: "NVDAc", usd: 10 }], []) === null, "no target: no drift to report");

d = computeDrift([{ symbol: "NVDAc", usd: 1 }, { symbol: "MSFTc", usd: 1 }], [{ symbol: "NVDAc", weightBps: 30 }, { symbol: "MSFTc", weightBps: 30 }]);
ok(d && near(d.driftPct, 0), "weights are normalized (30/30 = 50/50)");

const KNOWN = ["NVDAc", "MSFTc", "TSLAc"];
const good = { label: "MAXX-AI", mandate: "ai stocks", weights: T, savedAt: "2026-11-14T00:00:00.000Z" };
ok(parseSavedTarget(good, KNOWN)?.weights.length === 2, "a valid saved target is accepted");
ok(parseSavedTarget({ ...good, weights: [{ symbol: "FAKEc", weightBps: 10000 }] }, KNOWN) === null, "an unknown stock is rejected");
ok(parseSavedTarget({ ...good, weights: [{ symbol: "NVDAc", weightBps: 6000 }, { symbol: "MSFTc", weightBps: 5000 }] }, KNOWN) === null, "weights that don't sum to 100% are rejected");
ok(parseSavedTarget({ ...good, weights: [{ symbol: "NVDAc", weightBps: 5000 }, { symbol: "NVDAc", weightBps: 5000 }] }, KNOWN) === null, "a duplicated stock is rejected");
ok(parseSavedTarget("x", KNOWN) === null && parseSavedTarget(null, KNOWN) === null && parseSavedTarget({ label: 1, weights: [] }, KNOWN) === null, "garbage is rejected");
ok(parseSavedTarget({ ...good, label: "A".repeat(200) }, KNOWN)?.label.length === 64, "a long label is clamped");

const T3 = [{ symbol: "NVDAc", weightBps: 3000 }, { symbol: "MSFTc", weightBps: 3500 }, { symbol: "GOOGLc", weightBps: 3500 }];
d = computeDrift([{ symbol: "NVDAc", usd: 38 }, { symbol: "MSFTc", usd: 31 }, { symbol: "GOOGLc", usd: 31 }], T3, 35);
ok(d && d.breaches.length === 1 && d.breaches[0].symbol === "NVDAc", "a stock above the saved 35% limit is reported as a breach");
d = computeDrift([{ symbol: "NVDAc", usd: 35.3 }, { symbol: "MSFTc", usd: 32.35 }, { symbol: "GOOGLc", usd: 32.35 }], T3, 35);
ok(d && d.breaches.length === 0, "a tick over the limit (35.3% vs 35%) is not a breach");
ok(parseSavedTarget({ ...good, maxWeightPct: 60 }, KNOWN)?.maxWeightPct === 60, "a saved limit is kept");
ok(parseSavedTarget({ ...good, maxWeightPct: 30 }, KNOWN) === null, "a limit the target's own weights break (50% vs 30%) is rejected");

console.log(fail ? `\n❌ ${fail} check(s) failed` : "\n✅ All drift checks passed");
process.exit(fail ? 1 : 0);
