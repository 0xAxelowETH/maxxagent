#!/usr/bin/env node
/**
 * Generates MAXXAGENT brand assets into public/brand/:
 *   maxxagent-mark.svg / -512.png / -1024.png   (profile picture, favicon source)
 *   maxxagent-logo.svg / .png                    (horizontal lockup, dark background)
 *   maxxagent-x-banner.png                       (X / Twitter header 1500x500)
 *
 * Usage: npm run brand
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const out = path.join(process.cwd(), "public", "brand");
fs.mkdirSync(out, { recursive: true });

const defs = `
  <linearGradient id="bg" x1="6" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
    <stop stop-color="#0E2350"/><stop offset="1" stop-color="#050A18"/>
  </linearGradient>
  <linearGradient id="line" x1="14" y1="48" x2="52" y2="14" gradientUnits="userSpaceOnUse">
    <stop stop-color="#38BDF8"/><stop offset="0.55" stop-color="#6366F1"/><stop offset="1" stop-color="#34D399"/>
  </linearGradient>
  <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(49 17) scale(11)">
    <stop stop-color="#34D399" stop-opacity="0.55"/><stop offset="1" stop-color="#34D399" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="word" x1="0" y1="0" x2="1" y2="0">
    <stop stop-color="#38BDF8"/><stop offset="0.5" stop-color="#818CF8"/><stop offset="1" stop-color="#34D399"/>
  </linearGradient>`;

const markBody = `
  <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#bg)"/>
  <rect x="2.5" y="2.5" width="59" height="59" rx="15.5" stroke="#38BDF8" stroke-opacity="0.28" fill="none"/>
  <path d="M15 46V24L32 40L49 17V46" stroke="url(#line)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="49" cy="17" r="11" fill="url(#glow)"/>
  <circle cx="49" cy="17" r="5" fill="#34D399"/>
  <circle cx="49" cy="17" r="2" fill="#ECFDF5"/>`;

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none"><defs>${defs}</defs>${markBody}</svg>`;

const FONT = "Segoe UI, Arial, Helvetica, sans-serif";
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300" viewBox="0 0 1200 300" fill="none">
  <defs>${defs}</defs>
  <rect width="1200" height="300" fill="#03060E"/>
  <g transform="translate(70 50) scale(3.125)">${markBody}</g>
  <text x="330" y="182" font-family="${FONT}" font-size="118" font-weight="800" letter-spacing="-3">
    <tspan fill="#FFFFFF">MAXX</tspan><tspan fill="url(#word)">AGENT</tspan>
  </text>
  <text x="336" y="236" font-family="${FONT}" font-size="30" font-weight="500" fill="#94A3B8">Tokenized stock baskets on Base</text>
</svg>`;

const bannerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500" fill="none">
  <defs>${defs}
    <radialGradient id="spot" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1150 80) scale(700 420)">
      <stop stop-color="#6366F1" stop-opacity="0.35"/><stop offset="1" stop-color="#6366F1" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
      <path d="M50 0H0V50" stroke="#1E293B" stroke-opacity="0.55" fill="none"/>
    </pattern>
  </defs>
  <rect width="1500" height="500" fill="#03060E"/>
  <rect width="1500" height="500" fill="url(#grid)"/>
  <rect width="1500" height="500" fill="url(#spot)"/>
  <path d="M1010 215 L1085 172 L1145 190 L1225 122 L1285 140 L1360 72 L1425 52" stroke="url(#line)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.75" fill="none"/>
  <circle cx="1425" cy="52" r="11" fill="#34D399"/>
  <g transform="translate(110 170) scale(2.5)">${markBody}</g>
  <text x="300" y="262" font-family="${FONT}" font-size="104" font-weight="800" letter-spacing="-3">
    <tspan fill="#FFFFFF">MAXX</tspan><tspan fill="url(#word)">AGENT</tspan>
  </text>
  <text x="306" y="318" font-family="${FONT}" font-size="30" font-weight="500" fill="#CBD5E1">Agent-picked baskets of tokenized stocks, bought from your own wallet.</text>
  <text x="306" y="362" font-family="${FONT}" font-size="22" font-weight="500" fill="#64748B">Built on Base · Not financial advice</text>
</svg>`;

const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" fill="none">
  <defs>${defs}
    <radialGradient id="spot2" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(960 90) scale(620 460)">
      <stop stop-color="#6366F1" stop-opacity="0.38"/><stop offset="1" stop-color="#6366F1" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid2" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" stroke="#1E293B" stroke-opacity="0.55" fill="none"/></pattern>
  </defs>
  <rect width="1200" height="630" fill="#03060E"/><rect width="1200" height="630" fill="url(#grid2)"/><rect width="1200" height="630" fill="url(#spot2)"/>
  <path d="M760 250 L830 210 L880 228 L950 160 L1000 176 L1070 110 L1130 92" stroke="url(#line)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.75" fill="none"/>
  <circle cx="1130" cy="92" r="10" fill="#34D399"/>
  <g transform="translate(90 250) scale(2.2)">${markBody}</g>
  <text x="260" y="340" font-family="${FONT}" font-size="96" font-weight="800" letter-spacing="-3"><tspan fill="#FFFFFF">MAXX</tspan><tspan fill="url(#word)">AGENT</tspan></text>
  <text x="96" y="450" font-family="${FONT}" font-size="34" font-weight="600" fill="#E2E8F0">Agent-picked baskets of tokenized stocks on Base</text>
  <text x="96" y="500" font-family="${FONT}" font-size="26" font-weight="500" fill="#94A3B8">NVIDIA · Apple · Tesla · Microsoft · + 6 more — bought from your own wallet</text>
  <text x="96" y="570" font-family="${FONT}" font-size="20" font-weight="500" fill="#64748B">Not financial advice · eligible non-US persons only</text>
</svg>`;

fs.writeFileSync(path.join(out, "maxxagent-mark.svg"), markSvg);
fs.writeFileSync(path.join(out, "maxxagent-logo.svg"), logoSvg);
await sharp(Buffer.from(markSvg), { density: 1200 }).resize(512, 512).png().toFile(path.join(out, "maxxagent-mark-512.png"));
await sharp(Buffer.from(markSvg), { density: 2400 }).resize(1024, 1024).png().toFile(path.join(out, "maxxagent-mark-1024.png"));
await sharp(Buffer.from(logoSvg)).png().toFile(path.join(out, "maxxagent-logo.png"));
await sharp(Buffer.from(bannerSvg)).png().toFile(path.join(out, "maxxagent-x-banner.png"));
await sharp(Buffer.from(ogSvg)).png().toFile(path.join(out, "maxxagent-og.png"));
// Apple touch icon for the web app
await sharp(Buffer.from(markSvg), { density: 600 }).resize(180, 180).png().toFile(path.join(process.cwd(), "src", "app", "apple-icon.png"));

console.log("✅ Brand assets written to public/brand/ (+ src/app/apple-icon.png)");
for (const f of fs.readdirSync(out)) console.log("   -", f);
