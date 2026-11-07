# Build in public: daily posts

25% of the Stocks Maxxing score is **"Build in public: dated progress posts and community growth"**, and the best build-in-public project wins an extra $6,000. This folder keeps one subfolder per day with the screenshots and the post text.

```
build-in-public/
  day-01-2026-11-06/
    post.md                       ← post text, image order, link after posting
    01-market-desktop.png
    02-price-chart-desktop.png
    03-agent-basket-desktop.png
    04-portfolio-desktop.png
    05-market-mobile.png
    06-agent-mobile.png
    07-terms-gate-desktop.png     (only with --gate)
  day-02-YYYY-MM-DD/
  ...
```

## Daily routine (about 5 minutes)

1. Start the app: `npm run dev`
2. Capture fresh screenshots: `npm run shots -- <day>` (for example `npm run shots -- 2`).
   - It creates `day-XX-<today>/` with the screenshots and a `post.md` draft.
   - Add `--gate` to also capture the terms screen, or `--url=https://...` for the live site.
3. Edit `post.md`: write what you **actually** shipped today.
4. Post on X with up to 4 images, and **always tag @buildonbase** (Bankr asks for this on every post). Keep it **≤ 280 characters** (emoji count as 2). Put extra detail in a reply thread.
5. Paste the post link into `post.md` under "Posted".

## Rules for posts

- Only post what really works today. No mock data or "coming soon" claims presented as done.
- Show real onchain proof when you have it (BaseScan links with the ERC-8021 Builder Code).
- Add "Not financial advice."
- Don't show private data: no seed phrases, private keys, API keys, or `.env.local`.

## Log

| Day | Date | Topic | Posted |
| --- | --- | --- | --- |
| 1 | 2026-11-06 | Live market + agent + one-click basket | ✅ |
| 2 | 2026-11-07 | First mainnet test buy + mobile wallets + open source | ☐ |
| 3 | 2026-11-08 | Selling live + full mainnet round trip | ☐ |
