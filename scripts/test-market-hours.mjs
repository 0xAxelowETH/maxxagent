// Unit checks for NavChartGap segmentation (src/lib/marketHours.ts). No network, no wallet.
//   npm run test:market
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "maxx-market-"));
let splitNavWeekendGaps;
try {
  const js = ts.transpileModule(readFileSync("src/lib/marketHours.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const file = join(dir, "marketHours.mjs");
  writeFileSync(file, js);
  ({ splitNavWeekendGaps } = await import(pathToFileURL(file).href));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "✅ " : "❌ ") + m);
  if (!c) fail++;
};

const empty = splitNavWeekendGaps([]);
ok(empty.segments.length === 0 && empty.gaps.length === 0, "empty series returns zero segments and gaps");

const weekdayOnly = [
  [1000, 100],
  [1000 + 3600, 101],
  [1000 + 7200, 102],
];
const cont = splitNavWeekendGaps(weekdayOnly);
ok(cont.gaps.length === 0 && cont.segments.length === 1 && cont.segments[0].length === 3, "continuous 1h steps stay in 1 segment");

const withWeekend = [
  [10_000, 140],
  [10_000 + 3600, 141],
  [10_000 + 3600 + 48 * 3600, 143],
  [10_000 + 3600 + 50 * 3600, 144],
];
const w = splitNavWeekendGaps(withWeekend);
ok(w.gaps.length === 1 && w.segments.length === 2, "48h weekend gap splits into 2 segments + 1 gap");
ok(w.gaps[0].from[1] === 141 && w.gaps[0].to[1] === 143, "gap records exact Friday close and Monday open anchor points");

const unsortedWithHoliday = [
  [300_000, 155],
  [10_000, 150],
  [100_000, 152],
  [12_000, 151],
];
const uh = splitNavWeekendGaps(unsortedWithHoliday);
ok(uh.gaps.length === 2 && uh.segments.length === 3, "unsorted input sorts chronologically and splits across multi-day gaps");

if (fail > 0) process.exit(1);
console.log("All market-hours unit checks passed.");
