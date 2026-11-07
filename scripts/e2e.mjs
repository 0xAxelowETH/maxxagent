// End-to-end user journeys with a READ-ONLY mock wallet. No transaction can be sent: every send request is
// recorded, then rejected (or answered as "unsupported" / an odd error, to test the fallbacks).
//
//   npm run test:e2e                         (needs `npm run dev` on :3000)
//   npm run test:e2e -- --url=https://...    (against a deployment)
//   npm run test:e2e -- --headful            (watch it)
//
// Each bug found by hand becomes a step here, so it cannot come back unnoticed.
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? d;
const URL_BASE = arg("url", "http://localhost:3000").replace(/\/$/, "");
// Test wallet: holds a little USDC and NVDAc on Base (read-only here)
const WALLET = arg("wallet", "0xD986C711F575C71dA22Bd08742b9DB2091Ba9e33");
const BROWSER =
  process.env.CHROME_PATH ||
  ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
if (!BROWSER) {
  console.log("No Chrome/Edge found. Set CHROME_PATH.");
  process.exit(1);
}

let failures = 0;
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    const note = await fn();
    results.push(`✅ ${name}${note ? ` — ${note}` : ""} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failures++;
    results.push(`❌ ${name} — ${(e?.message || String(e)).split("\n")[0].slice(0, 200)}`);
  }
  console.log(results.at(-1));
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Injected before any page script. window.__mock controls behaviour; window.__calls records requests.
const MOCK = (wallet) => {
  const state = JSON.parse(sessionStorage.getItem("__mock") || "null") || { chain: "0x2105", sendCalls: "reject", sendTx: "reject" };
  window.__mock = state;
  window.__calls = [];
  const save = () => sessionStorage.setItem("__mock", JSON.stringify(window.__mock));
  const rpc = (method, params) =>
    fetch("https://mainnet.base.org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
      .then((r) => r.json())
      .then((j) => (j.error ? Promise.reject(j.error) : j.result));
  const reject = () => Promise.reject(Object.assign(new Error("User rejected the request."), { code: 4001 }));
  const listeners = {};
  const provider = {
    request: async ({ method, params }) => {
      window.__calls.push(method);
      const m = window.__mock;
      if (method === "eth_chainId") return m.chain;
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [wallet];
      if (method === "wallet_switchEthereumChain") {
        m.chain = params?.[0]?.chainId || "0x2105";
        save();
        (listeners.chainChanged || []).forEach((f) => f(m.chain));
        return null;
      }
      if (["eth_call", "eth_getTransactionReceipt", "eth_blockNumber", "eth_getBalance"].includes(method)) return rpc(method, params);
      if (method === "wallet_sendCalls") {
        if (m.sendCalls === "unsupported") return Promise.reject(Object.assign(new Error("Method not supported"), { code: -32601 }));
        if (m.sendCalls === "weird") return Promise.reject(Object.assign(new Error("Internal JSON-RPC error."), { code: -32603 }));
        return reject();
      }
      return reject(); // eth_sendTransaction and anything else that would act
    },
    on(ev, f) {
      (listeners[ev] ||= []).push(f);
    },
    removeListener(ev, f) {
      listeners[ev] = (listeners[ev] || []).filter((x) => x !== f);
    },
  };
  const detail = Object.freeze({ info: { uuid: "e2e-mock", name: "E2E Mock Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "test.e2e" }, provider });
  window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail })));
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
};

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: process.argv.includes("--headful") ? false : "new" });
const page = await browser.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(e.message.slice(0, 160)));
// "Failed to load resource" console lines are reported via the response URL below instead (more useful)
page.on("console", (m) => m.type() === "error" && !/User rejected|read-only|4001|Failed to load resource/i.test(m.text()) && consoleErrors.push(m.text().slice(0, 160)));
const serverErrors = [];
page.on("response", async (r) => {
  if (r.status() < 500 || !r.url().startsWith(URL_BASE)) return;
  const body = await r.text().catch(() => "");
  // Expected, handled upstream condition: the aggregator rate-limits bursts of quotes; the app retries and
  // shows the leg as "Not included" if it still has no route
  if (r.url().includes("/api/swap") && /No route available|Could not build/.test(body)) return;
  serverErrors.push(`${r.status()} ${r.url().replace(URL_BASE, "")} ${body.slice(0, 120)}`);
});
await page.setViewport({ width: 390, height: 900, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(MOCK, WALLET);

const text = () => page.evaluate(() => document.body.innerText);
// Waits (up to `timeout`) for a visible element whose text matches, then clicks it. false if it never shows.
const click = (selector, re, timeout = 10000) =>
  page
    .waitForFunction(
      (sel, src, flags) => {
        const r = new RegExp(src, flags);
        const el = [...document.querySelectorAll(sel)].find((b) => b.offsetParent !== null && !b.disabled && r.test(b.textContent.trim()));
        if (!el) return false;
        el.click();
        return true;
      },
      { timeout, polling: 200 },
      selector,
      re.source,
      re.flags
    )
    .then(() => true)
    .catch(() => false);
const waitText = (re, timeout = 30000) => page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), { timeout }, re.source);
const setMock = (m) => page.evaluate((m) => { Object.assign(window.__mock, m); sessionStorage.setItem("__mock", JSON.stringify(window.__mock)); window.__calls = []; }, m);
const calls = () => page.evaluate(() => window.__calls.slice());
const shortAddr = `${WALLET.slice(0, 6)}...${WALLET.slice(-4)}`;
const connected = async () => (await text()).includes(shortAddr);
const tab = (name) => click("nav button", new RegExp(`^${name}`));
const dismissToast = () => page.evaluate(() => document.querySelector('[aria-label="Dismiss"]')?.click());

const buyOneDollar = async () => {
  await tab("Market");
  await page.waitForSelector("#swap-panel input", { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll("#swap-panel button")].find((b) => /^buy /i.test(b.textContent.trim()))?.click());
  const input = await page.$("#swap-panel input");
  await input.click({ clickCount: 3 });
  await input.type("1");
  assert(await click("#swap-panel button", /^Buy \$1\.00/), "Buy $1.00 button not found");
};

console.log(`E2E — ${URL_BASE} — mock wallet ${shortAddr}\n`);

await step("Home loads, terms gate blocks until all statements are confirmed", async () => {
  const res = await page.goto(URL_BASE + "/", { waitUntil: "load", timeout: 120000 });
  assert(res.status() === 200, `status ${res.status()}`);
  await waitText(/Agree and enter|Confirm all \d+ statements/, 30000);
  assert(await page.$eval("button:disabled", () => true).catch(() => false), "accept button should start disabled");
  await page.$$eval('input[type="checkbox"]', (els) => els.forEach((e) => e.click()));
  assert(await click("button", /^Agree and enter/), "Agree button");
  await sleep(800);
  assert(!(await text()).includes("Agree and enter"), "gate still visible");
});

await step("Connect wallet (EIP-6963 picker)", async () => {
  assert(await click("button", /connect/i), "Connect button");
  await sleep(500);
  assert(await click("button", /E2E Mock Wallet/), "mock wallet not listed in the picker");
  await waitText(new RegExp(shortAddr.replace(/\./g, "\\.")), 20000);
  return `shows ${shortAddr}`;
});

await step("Refresh keeps the wallet connected (no popup)", async () => {
  await page.reload({ waitUntil: "load" });
  await waitText(new RegExp(shortAddr.replace(/\./g, "\\.")), 20000);
  const c = await calls();
  assert(!c.includes("eth_requestAccounts"), "reconnect must not prompt (eth_requestAccounts called)");
});

await step("Switching stocks updates the Swap panel quickly", async () => {
  await page.waitForSelector("#swap-panel", { timeout: 30000 });
  const t = Date.now();
  assert(await click("button", /^AAPLc$/), "AAPLc chip");
  await page.waitForFunction(() => /AAPLc/.test(document.getElementById("swap-panel")?.innerText || ""), { timeout: 5000 });
  return `${Date.now() - t} ms`;
});

await step("Buy $1 opens the review; the wallet is not asked before Confirm", async () => {
  await setMock({ sendCalls: "reject" });
  await buyOneDollar();
  await page.waitForSelector('[role="dialog"]', { timeout: 60000 });
  const d = await page.$eval('[role="dialog"]', (e) => e.innerText);
  assert(/Review your order/i.test(d) && /Minimum/.test(d) && /Max slippage/.test(d), "review content incomplete");
  assert(!/\d,\d{2}\b/.test(d.replace(/\d{1,3}(,\d{3})+(\.\d+)?/g, "")), "locale-formatted number (comma decimal) in review");
  const c = await calls();
  assert(!c.some((m) => ["wallet_sendCalls", "eth_sendTransaction"].includes(m)), `sent before confirm: ${c.join(",")}`);
});

await step("Confirm asks the wallet once; a rejection is not retried another way", async () => {
  assert(await click('[role="dialog"] button', /Confirm in wallet/), "Confirm button");
  await waitText(/Order not completed/, 30000);
  const c = await calls();
  assert(c.filter((m) => m === "wallet_sendCalls").length === 1, `wallet_sendCalls count ${c.filter((m) => m === "wallet_sendCalls").length}`);
  assert(!c.includes("eth_sendTransaction"), "fell back to one-by-one after the user rejected");
  await dismissToast();
});

await step("Wallet without batching ('unsupported') falls back to one-by-one", async () => {
  await setMock({ sendCalls: "unsupported" });
  await buyOneDollar();
  await page.waitForSelector('[role="dialog"]', { timeout: 60000 });
  await click('[role="dialog"] button', /Confirm in wallet/);
  await waitText(/Order not completed/, 30000);
  const c = await calls();
  assert(c.includes("wallet_sendCalls") && c.includes("eth_sendTransaction"), `calls: ${c.filter((m) => !m.startsWith("eth_c")).join(",")}`);
  await dismissToast();
});

await step("Wallet with an odd batch error also falls back (after the no-double-send check)", async () => {
  await setMock({ sendCalls: "weird" });
  await buyOneDollar();
  await page.waitForSelector('[role="dialog"]', { timeout: 60000 });
  await click('[role="dialog"] button', /Confirm in wallet/);
  await waitText(/Order not completed/, 40000);
  const c = await calls();
  assert(c.includes("eth_sendTransaction"), "no fallback after an unrecognised batch error");
  await dismissToast();
  await setMock({ sendCalls: "reject" });
});

await step("Wallet on the wrong network is asked to switch to Base", async () => {
  await setMock({ chain: "0x1" });
  await buyOneDollar();
  await page.waitForSelector('[role="dialog"]', { timeout: 60000 });
  const c = await calls();
  assert(c.includes("wallet_switchEthereumChain"), "no switch request");
  await click('[role="dialog"] button', /^Cancel$/);
});

await step("Agent basket: buy opens a multi-stock review or a clear funds message", async () => {
  await tab("Agent");
  await waitText(/Buy basket for \$/, 60000);
  await click("button", /^Buy basket for \$/);
  await page.waitForFunction(() => document.querySelector('[role="dialog"]') || /Not enough USDC|at least \$/.test(document.body.innerText), { timeout: 90000 });
  const dlg = await page.$('[role="dialog"]');
  if (dlg) {
    await click('[role="dialog"] button', /^Cancel$/);
    return "review opened";
  }
  return "clear message shown (test wallet has little USDC)";
});

await step("Portfolio: balances, P/L and visible Sell buttons at phone width", async () => {
  await dismissToast();
  await tab("Portfolio");
  await page.waitForFunction(() => [...document.querySelectorAll("table button")].some((b) => b.textContent.trim() === "All"), { timeout: 40000 });
  await page.waitForFunction(() => /Unrealized P\/L[^\n]*\n\s*[+−-]\$/.test(document.body.innerText), { timeout: 60000 });
  const box = await page.evaluate(() => {
    const b = [...document.querySelectorAll("table button")].find((x) => x.textContent.trim() === "All");
    const r = b.getBoundingClientRect();
    return { right: r.right, vw: window.innerWidth };
  });
  assert(box.right <= box.vw, `Sell 'All' button off screen (${Math.round(box.right)} > ${box.vw})`);
});

await step("Sell 50% opens a sell review; nothing sent before Confirm", async () => {
  await setMock({});
  await click("table button", /^50%$/);
  await page.waitForSelector('[role="dialog"]', { timeout: 60000 });
  const d = await page.$eval('[role="dialog"]', (e) => e.innerText);
  assert(/Sell/.test(d) && /USDC/.test(d), "not a sell review");
  assert(!(await calls()).some((m) => ["wallet_sendCalls", "eth_sendTransaction"].includes(m)), "sent before confirm");
  await click('[role="dialog"] button', /^Cancel$/);
});

await step("No horizontal scrolling on any tab at 390px", async () => {
  const bad = [];
  for (const t of ["Market", "Agent", "Indexes", "Portfolio"]) {
    await tab(t);
    await sleep(700);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 390) bad.push(`${t}:${w}px`);
  }
  assert(bad.length === 0, bad.join(" "));
});

await step("Disconnect, then refresh: stays disconnected", async () => {
  await page.evaluate(() => document.querySelector('button[title="Disconnect"]')?.click());
  await sleep(800);
  await page.reload({ waitUntil: "load" });
  await sleep(5000);
  assert(!(await connected()), "reconnected after an explicit disconnect");
});

await step("FAQ, Terms, robots, sitemap respond; unknown page is 404", async () => {
  const st = [];
  for (const [p, want] of [["/faq", 200], ["/terms", 200], ["/robots.txt", 200], ["/sitemap.xml", 200], ["/no-such-page", 404]]) {
    const r = await fetch(URL_BASE + p);
    if (r.status !== want) st.push(`${p}=${r.status}`);
  }
  assert(st.length === 0, st.join(" "));
});

await step("No unexpected errors in the browser console", async () => {
  assert(consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
});

await step("No server errors (5xx) from the app's own API", async () => {
  assert(serverErrors.length === 0, serverErrors.slice(0, 3).join(" | "));
});

await browser.close();
console.log(failures ? `\n❌ ${failures} step(s) failed` : `\n✅ All ${results.length} steps passed`);
process.exitCode = failures ? 1 : 0;
