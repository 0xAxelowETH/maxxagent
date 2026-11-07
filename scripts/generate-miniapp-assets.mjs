#!/usr/bin/env node
// Mini app images from the existing brand assets (Farcaster Mini Apps spec):
//   icon 1024x1024 PNG without alpha, splash 200x200, embed 3:2 (1200x800)
//   node scripts/generate-miniapp-assets.mjs
import path from "node:path";
import sharp from "sharp";

const dir = path.join(process.cwd(), "public", "brand");
const BG = "#03060e";

await sharp(path.join(dir, "maxxagent-mark-1024.png"))
  .flatten({ background: BG })
  .resize(1024, 1024)
  .removeAlpha()
  .png()
  .toFile(path.join(dir, "miniapp-icon-1024.png"));

await sharp(path.join(dir, "maxxagent-mark-512.png"))
  .flatten({ background: BG })
  .resize(200, 200)
  .removeAlpha()
  .png()
  .toFile(path.join(dir, "miniapp-splash-200.png"));

// 1200x630 Open Graph image extended to 3:2 with the same background
await sharp(path.join(dir, "maxxagent-og.png"))
  .flatten({ background: BG })
  .extend({ top: 85, bottom: 85, left: 0, right: 0, background: BG })
  .removeAlpha()
  .png()
  .toFile(path.join(dir, "miniapp-embed-1200x800.png"));

for (const f of ["miniapp-icon-1024.png", "miniapp-splash-200.png", "miniapp-embed-1200x800.png"]) {
  const m = await sharp(path.join(dir, f)).metadata();
  console.log(`${f}: ${m.width}x${m.height}, alpha=${m.hasAlpha}`);
}
