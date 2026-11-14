# Testing MAXXAGENT

Run the automated checks on every change, and the manual checklist before every deploy.
Nothing here sends a transaction except the steps marked **real money**.

## 1. Automated (no wallet, no money)

Start the app first: `npm run dev`.

| Command | What it proves |
| --- | --- |
| `npx tsc --noEmit` and `npm run lint` | No type errors, no lint errors |
| `npm run test:contracts` | Index registry contract rules (19 checks) |
| `npm run test:e2e` | 25 user journeys (add `-- --width=1440` for desktop, `-- --url=https://maxxagent.xyz` for production) in a real browser with a read-only mock wallet: terms gate, connect, reconnect after refresh, Swap panel, review before signing, rejection not retried, fallback for wallets without batching (and odd batch errors, with the no-double-send check), wrong network, Agent basket, a basket with one reverted swap, a late batch never resent, Portfolio P/L and Sell at phone width, agent limits / facts / unsupported stock, saved target and drift after a reload, shared basket links, stats, no horizontal scroll, disconnect, pages, console and 5xx errors. ~3 min. A local `next dev` can be slow enough to time out on Portfolio; production is the reference run. |
| `npm run test:agent` | 47 request-reader checks: themes, names, exclusions, counts, equal weights, user-set weights ("60% Apple 40% Microsoft", "Apple 60% …", "half in Nvidia", "30% di Tesla"), caps and cash never read as weights, Strategy Inc only in a list of companies, Indonesian words, unsupported Coinbase stocks (Netflix → NFLXc) vs ones Coinbase doesn't issue, profitable / growth. Plus weight capping and rounding |
| `npm run test:rebalance` | Rebalance planner rules: sells before buys, proceeds reinvested, tolerance band, $1 minimum, no dust |
| `npm run test:drift` / `npm run test:indexmatch` | Saved-target drift and limit checks; recognising buys of a published index from onchain swaps |
| `npm run test:attribution` | Every swap from `/api/swap` ends with the Builder Code for EOAs, EIP-7702 batches (MetaMask), ERC-7579 and ERC-4337 smart wallets (Coinbase Smart Wallet). It also checks the router accepts the calldata (`eth_call`). |
| `npm run test:swap` | Quotes for all 10 stocks (routes, cost, Builder Code), spaced out because KyberSwap answers "Forbidden" to bursts |
| `npm run test:buy` / `npm run test:sell` | Dry run of a buy / sell from the test wallet (no `--execute` = nothing is sent) |
| `NEXT_DIST_DIR=.next-audit npx next build` | Production build, without touching a running `next dev` |

`test:attribution` exits with code 1 on any failure. It includes a control case that proves it can detect the old batch-padding bug.

## 2. After any real trade

```
npm run verify:trades -- --wallet=0xTheWalletYouTradedWith --hours=24
```

Reads the wallet's trades onchain, the way indexers do (tx input for EOA / EIP-7702, UserOperation `callData` for ERC-4337), and marks each one ✅ attributed or ❌ not attributed. Any ❌ on a trade made in MAXXAGENT after the fix is a release blocker.

## 3. Manual checklist before a deploy

Use small amounts ($1–$2). Do it on a phone **and** on a desktop.

**Wallets**
- [ ] Connect with a browser wallet (MetaMask or Coinbase Wallet extension)
- [ ] Connect with Coinbase Smart Wallet (passkey popup)
- [ ] Connect with WalletConnect from a phone wallet
- [ ] Disconnect (✕), then connect a different account: balances switch to the new account

**Trading — real money**
- [ ] Market tab → Swap panel: buy $1 of one stock. A **Review your order** screen opens first (amount, estimate, minimum, cost, vs NAV); the wallet does NOT open until **Confirm in wallet**
- [ ] Wait past the 45 s countdown: the button turns into "Quote expired — refresh" and shows fresh numbers before anything is sent
- [ ] After Confirm, the wallet shows one prompt (batch) or approve + swap
- [ ] Toast says "Purchase confirmed" and shows what was received
- [ ] Portfolio shows the new position within a few seconds
- [ ] Sell 50%, then All, from the Portfolio tab: "Sale confirmed", USDC comes back
- [ ] Agent tab: buy a basket of at least 5 stocks (amount ≥ the minimum the app asks for)
- [ ] `npm run verify:trades -- --wallet=...` shows ✅ for every one of these trades

**Guards**
- [ ] Amount below $1 or above the USDC balance: the Buy button explains why and is disabled
- [ ] Rejecting in the wallet shows "Order not completed", nothing is sent
- [ ] Wrong network: the app asks the wallet to switch to Base

**Speed and layout**
- [ ] Switching stocks on the Market chart shows the new price at once
- [ ] Portfolio loads in under ~2 seconds, with a loading state (never "No tokenized stocks" while loading)
- [ ] No horizontal scrolling at phone width; Sell buttons visible without scrolling sideways
- [ ] No errors in the browser console

**Before going public**
- [ ] Production URL added to Reown (WalletConnect) Allowed Domains
- [ ] `NEXT_PUBLIC_SITE_URL` set to the production URL
- [ ] `.env.local` is not committed (`git ls-files | grep env` shows only `.env.example`)
