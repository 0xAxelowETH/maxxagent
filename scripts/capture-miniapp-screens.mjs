#!/usr/bin/env node
// Portrait store screenshots for the mini app manifest (1284x2778 = 428x926 at 3x).
//   node scripts/capture-miniapp-screens.mjs [--url=http://localhost:3000]
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? d;
const BASE = arg("url", "http://localhost:3000").replace(/\/$/, "");
const BROWSER =
  process.env.CHROME_PATH ||
  ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const out = path.join(process.cwd(), "public", "brand", "screens");
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 428, height: 926, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() =>
  localStorage.setItem("maxxagent_terms_v1", JSON.stringify({ acceptedAt: new Date().toISOString(), version: "1" }))
);
const scrollTo = (sel) =>
  page.evaluate((sel) => {
    const el = typeof sel === "string" ? document.querySelector(sel) : null;
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
  }, sel);

// 1) Home: the index-first hero
await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 120000 });
await sleep(3500);
await page.evaluate(() => {
  const h = [...document.querySelectorAll("h2")].find((x) => /Build your own stock index/.test(x.textContent));
  if (h) window.scrollTo(0, h.closest(".glass-panel").getBoundingClientRect().top + window.scrollY - 70);
});
await sleep(800);
await page.screenshot({ path: path.join(out, "screen-1.png") });

// 2) Agent: a plain-language mandate and how it was read
await page.evaluate(() => [...document.querySelectorAll("nav button")].find((b) => /^Agent/.test(b.textContent.trim()))?.click());
await sleep(1500);
await page.evaluate(() => {
  const ta = document.querySelector("textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, "AI and cloud, no Tesla, 3 stocks, equal weight");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Run agent/.test(b.textContent.trim()))?.click());
await page.waitForSelector('[data-testid="agent-interpretation"]', { timeout: 60000 });
await sleep(1500);
await scrollTo('[data-testid="agent-interpretation"]');
await page.evaluate(() => window.scrollBy(0, -120));
await sleep(800);
await page.screenshot({ path: path.join(out, "screen-2.png") });

// 3) A stock page: live NAV vs DEX and the 7-day chart
await page.goto(BASE + "/stock/NVDAc", { waitUntil: "networkidle2", timeout: 120000 });
await page.waitForSelector('[data-testid="stock-live"]', { timeout: 60000 });
await sleep(2500);
await page.screenshot({ path: path.join(out, "screen-3.png") });

await browser.close();
for (const f of fs.readdirSync(out)) console.log(f, fs.statSync(path.join(out, f)).size, "bytes");
