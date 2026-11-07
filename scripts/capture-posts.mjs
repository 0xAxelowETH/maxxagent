#!/usr/bin/env node
/**
 * Build-in-public helper: captures fresh screenshots of the running app into
 *   build-in-public/day-XX-YYYY-MM-DD/
 * and creates a post.md draft (only if it doesn't exist yet).
 *
 * Usage:
 *   npm run dev                      (in another terminal)
 *   npm run shots -- 2               (day number; defaults to days since Nov 6, 2026 + 1)
 *   npm run shots -- 2 --url=https://your-app.vercel.app
 *   npm run shots -- 1 --gate        (also capture the first-visit terms gate)
 *
 * Uses the locally installed Microsoft Edge (or Chrome) through puppeteer-core.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}`));
const url = (flag("url")?.split("=")[1] || "http://localhost:3000").replace(/\/$/, "") + "/";
const withGate = Boolean(flag("gate"));
const START = new Date("2026-11-06T00:00:00+07:00");
const today = new Date();
const dayArg = args.find((a) => /^\d+$/.test(a));
const day = dayArg ? Number(dayArg) : Math.max(1, Math.floor((today - START) / 86_400_000) + 1);
const ymd = new Date(today.getTime() + 7 * 3600_000).toISOString().slice(0, 10); // WIB date

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];
const executablePath = process.env.BROWSER_PATH || BROWSERS.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error("No Edge/Chrome found. Set BROWSER_PATH to your browser executable.");
  process.exit(1);
}

const dir = path.join(process.cwd(), "build-in-public", `day-${String(day).padStart(2, "0")}-${ymd}`);
fs.mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(browser, { width, height, mobile, acceptTerms = true }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: mobile ? 3 : 1.5, isMobile: mobile, hasTouch: mobile });
  if (acceptTerms) {
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem("maxxagent_terms_v1", JSON.stringify({ acceptedAt: "screenshot" }));
      } catch {}
    });
  }
  await page.goto(url, { waitUntil: "networkidle2", timeout: 120_000 });
  await sleep(2500);
  return page;
}

async function clickTab(page, label) {
  await page.evaluate((l) => {
    const b = [...document.querySelectorAll("nav button")].find((x) => x.textContent.trim().startsWith(l) && x.offsetParent !== null);
    b?.click();
  }, label);
  await sleep(2500);
}

/**
 * Screenshots one panel: finds the element whose text starts with `findText`, climbs to the
 * closest ancestor matching `containerSel`, and captures it (sticky header disabled, max height cropped).
 */
async function shotOf(page, findText, containerSel, file, maxCssHeight = 1100) {
  // wait until the target text is rendered (e.g. chart history finished loading)
  await page
    .waitForFunction((t) => document.body.innerText.includes(t), { timeout: 25_000 }, findText)
    .catch(() => {});
  await page.addStyleTag({ content: "header{position:static!important} .fixed{display:none!important}" });
  const handle = await page.evaluateHandle(
    (t, sel) => {
      // match on direct text nodes, so labels with icon children are found too
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (parent && parent.offsetParent !== null && node.textContent.trim().startsWith(t)) return parent.closest(sel);
      }
      return null;
    },
    findText,
    containerSel
  );
  const el = handle.asElement();
  if (!el) return console.log(`  - skipped ${file} (not found: "${findText}")`);
  await el.scrollIntoView();
  await sleep(900);
  const buf = await el.screenshot({ type: "png" });
  const scale = page.viewport().deviceScaleFactor || 1;
  const meta = await sharp(buf).metadata();
  const maxPx = Math.round(maxCssHeight * scale);
  const pad = Math.round(24 * scale);
  await sharp(buf)
    .extract({ left: 0, top: 0, width: meta.width, height: Math.min(meta.height, maxPx) })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#03060e" })
    .png()
    .toFile(path.join(dir, file));
  console.log(`  ✓ ${file}`);
}

const browser = await puppeteer.launch({ executablePath, headless: "new" });
try {
  console.log(`Capturing ${url} → ${path.relative(process.cwd(), dir)}`);

  // Desktop
  const d = await openPage(browser, { width: 1440, height: 810, mobile: false });
  await d.screenshot({ path: path.join(dir, "01-market-desktop.png") });
  console.log("  ✓ 01-market-desktop.png");
  await d.waitForFunction(() => /Chainlink NAV \([1-9]/.test(document.body.innerText), { timeout: 30_000 }).catch(() => {});
  await shotOf(d, "Chainlink NAV (", ".glass-panel", "02-price-chart-desktop.png", 900);
  await clickTab(d, "Agent");
  await sleep(2500);
  await shotOf(d, "Buy this basket with USDC", "div.space-y-6", "03-agent-basket-desktop.png");
  const d2 = await openPage(browser, { width: 1440, height: 810, mobile: false });
  await clickTab(d2, "Portfolio");
  await d2.screenshot({ path: path.join(dir, "04-portfolio-desktop.png") });
  console.log("  ✓ 04-portfolio-desktop.png");

  // Mobile
  const m = await openPage(browser, { width: 390, height: 844, mobile: true });
  await m.screenshot({ path: path.join(dir, "05-market-mobile.png") });
  console.log("  ✓ 05-market-mobile.png");
  await clickTab(m, "Agent");
  await m.screenshot({ path: path.join(dir, "06-agent-mobile.png") });
  console.log("  ✓ 06-agent-mobile.png");

  if (withGate) {
    const g = await openPage(browser, { width: 1440, height: 900, mobile: false, acceptTerms: false });
    await g.screenshot({ path: path.join(dir, "07-terms-gate-desktop.png") });
    console.log("  ✓ 07-terms-gate-desktop.png");
  }
} finally {
  await browser.close();
}

const postFile = path.join(dir, "post.md");
if (!fs.existsSync(postFile)) {
  fs.writeFileSync(
    postFile,
    `# Day ${day} — ${ymd}\n\n## Post (copy to X)\n\n\`\`\`\nDay ${day} building MAXXAGENT for #StocksMaxxing on @base 🔵\n\n✅ <what you actually shipped today>\n\nNext: <tomorrow's goal>\n\nNot financial advice. @buildonbase\n\`\`\`\n\n## Images to attach (max 4)\n\n- 01-market-desktop.png\n- 03-agent-basket-desktop.png\n- 05-market-mobile.png\n\n## Posted\n\n- [ ] Link to post: \n`
  );
  console.log("  ✓ post.md (draft)");
} else {
  console.log("  • post.md already exists — kept");
}
console.log("Done.");
