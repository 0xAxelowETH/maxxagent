# Security policy

MAXXAGENT is a non-custodial interface: it never holds funds, private keys or standing approvals. Every transaction is built for the connected wallet and signed by its owner, and approvals are for the exact amount of each swap. Even so, a bug in how transactions are built or checked could cost users money, so reports are very welcome.

## Reporting a vulnerability

Please report privately, not in a public issue:

- **Preferred:** [open a private security advisory](https://github.com/0xAxelowETH/maxxagent/security/advisories/new) on this repository.
- **Alternatively:** send a direct message to [@Axelow17](https://x.com/Axelow17) on X asking for a private channel. Don't put the details in the first message.

Please include:
- what is affected (page, API route or file), and how to reproduce it
- what an attacker could do, and under which conditions
- any proof of concept: read-only, or on a fork or testnet, **never against other people's funds**

You should get a first answer within 72 hours. Fixes for anything that can move or lose funds take priority over everything else. Credit is given in the fix's commit and release notes unless you prefer otherwise. There is no paid bug bounty.

## Scope

In scope:
- swap building and checks in `src/app/api/swap` and `src/lib/basketExecutor.ts`: router allowlist, cost cap, Chainlink NAV guard, exact approvals, double-send guards, Builder Code
- the index registry contract `contracts/StockMaxxIndexRegistry.sol` ([verified on BaseScan](https://basescan.org/address/0xdd059D85d1327a5A4b9cA14cF0A6DF82C7b86909#code))
- the geo-restriction, the cron and webhook authentication, and secret handling in `src/middleware.ts` and `src/app/api/*`
- anything that could make the app show a wrong amount, a wrong recipient or a misleading review before signing

Out of scope:
- the Coinbase tokenized stock (B20) contracts, Chainlink feeds, KyberSwap, wallets, DexScreener and other third-party services (report those to their owners)
- third-party tokens listed read-only in the Paired tab
- rate limits on public read-only endpoints, missing headers without a concrete impact, and social engineering

## Supported version

Only the latest version on `main`, deployed at [maxxagent.xyz](https://maxxagent.xyz), is supported.
