import type { Metadata } from "next";
import Link from "next/link";
import { MaxxAgentLogo } from "@/components/BrandLogo";

export const metadata: Metadata = {
  title: "FAQ — MAXXAGENT",
  description:
    "How MAXXAGENT works: buying Coinbase tokenized stocks on Base from your own wallet, costs, approvals, P/L, risks and why the US is blocked.",
};

const GITHUB = "https://github.com/0xAxelowETH/maxxagent";

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is MAXXAGENT?",
    a: (
      <>
        A free, open-source interface for Coinbase tokenized stocks on Base. A rule-based agent proposes baskets from live
        data (Chainlink NAV, DEX prices, liquidity), and you buy or sell from your own wallet. MAXXAGENT never holds your
        funds and cannot move them.
      </>
    ),
  },
  {
    q: "What do I need to start?",
    a: (
      <>
        A wallet on Base (browser wallet, Coinbase Smart Wallet, or a phone wallet via WalletConnect), USDC or ETH on Base
        (at least $1 per stock), plus a little ETH on Base for network fees. No USDC? Choose <em>Pay with ETH</em> in the
        Swap panel. You must be outside the United States and meet the{" "}
        <Link href="/terms" className="text-cyan-300 underline">
          eligibility terms
        </Link>
        .
      </>
    ),
  },
  {
    q: "How does a purchase work?",
    a: (
      <ol className="list-decimal pl-5 space-y-1">
        <li>Choose an amount in the Swap panel (paid in USDC or ETH), or a basket in the Agent tab.</li>
        <li>MAXXAGENT finds a route on KyberSwap and shows a review: amount, estimate, guaranteed minimum, cost and price vs NAV.</li>
        <li>
          Only after <em>Confirm in wallet</em> does your wallet open. It asks for an exact-amount USDC approval (once per
          amount) and the swap, in one prompt if it supports batching.
        </li>
        <li>The stock tokens go straight to your wallet. The app then reads what actually arrived onchain.</li>
      </ol>
    ),
  },
  {
    q: "What are these tokens exactly?",
    a: (
      <>
        Coinbase-issued B20 tokens on Base that track US stocks (NVDAc, AAPLc, TSLAc…). They are not the shares themselves
        and give no voting or shareholder rights beyond what the token provides. A <em>multiplier</em> reflects dividends and
        splits, so one token can equal slightly more than one share over time. Coinbase publishes a prospectus for each
        token (linked on every stock card).
      </>
    ),
  },
  {
    q: "Why do NAV and DEX prices differ?",
    a: (
      <>
        The Chainlink NAV follows the real stock and updates while US markets are open (24/5). DEX prices trade 24/7, so on
        nights and weekends they can drift above or below NAV. MAXXAGENT shows both, and refuses a swap whose price is more
        than 5% worse than NAV.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        MAXXAGENT charges no fee. You pay network gas and the DEX cost of the route (price impact + pool fees), shown in the
        review before you sign. Routes costing more than 1.5% are refused. The default max slippage is 0.5%: if the price
        moves more than that before your swap lands, the swap reverts and you keep your funds (only gas is spent).
      </>
    ),
  },
  {
    q: "Why does my wallet ask for an approval?",
    a: (
      <>
        Token swaps need permission for the KyberSwap router to take the exact amount you are swapping (paying with ETH
        needs no approval). MAXXAGENT always
        requests the exact amount, never an unlimited approval, and only for KyberSwap&apos;s official router on Base.
      </>
    ),
  },
  {
    q: "How is my P/L calculated?",
    a: (
      <>
        From your own onchain history: the USDC you actually paid for each stock (or the ETH you paid, valued with Chainlink
        ETH/USD at that block) gives an average cost, and the live Chainlink NAV gives the current value. Realized P/L comes
        from the USDC you received when selling. If a stock arrived without a payment (bought with another token, sent from
        another wallet), its cost is valued at the NAV at that moment and marked <em>est.</em> The same history powers the{" "}
        <em>Trade history</em> list in the Portfolio tab, with a BaseScan link for every trade.
      </>
    ),
  },
  {
    q: "How does Rebalance work?",
    a: (
      <>
        In the Agent tab, once you hold stocks, MAXXAGENT compares your portfolio with the agent&apos;s basket weights. Step 1
        sells what is overweight; step 2 buys what is underweight with the USDC that came back (you can add extra USDC).
        Moves under 2% are skipped to save fees, and if your portfolio is too small for every stock to reach the $1
        minimum, it tells you how much to add instead of selling. Each step goes through the normal review screen.
      </>
    ),
  },
  {
    q: "Can I share a basket?",
    a: (
      <>
        Yes. <em>Copy share link</em> creates a link like <code>/?basket=NVDAc-40,MSFTc-30&amp;amount=50</code>. Whoever opens
        it sees the same basket loaded, ready to review. It only fills in the form: nothing is bought until they confirm in
        their own wallet.
      </>
    ),
  },
  {
    q: "Where can I see MAXXAGENT's usage?",
    a: (
      <>
        The{" "}
        <Link href="/stats" className="text-cyan-300 underline">
          Live stats
        </Link>{" "}
        page counts trades, volume and wallets routed through MAXXAGENT, read directly from onchain swap events, with each
        transaction linked so anyone can verify it. The team&apos;s own test wallet is excluded.
      </>
    ),
  },
  {
    q: "Why is the site blocked in the United States?",
    a: (
      <>
        Coinbase tokenized stocks are only available to persons in eligible jurisdictions outside the US, and apps that
        integrate them must apply that restriction. Visitors from the US and US territories see a block page.
      </>
    ),
  },
  {
    q: "What is the Builder Code in my transactions?",
    a: (
      <>
        Every swap carries MAXXAGENT&apos;s Base Builder Code (an ERC-8021 tag at the end of the transaction data). It credits
        the activity to MAXXAGENT for the Base Stocks Maxxing Season. It does not change what you pay or receive.
      </>
    ),
  },
  {
    q: "Is it safe? Can I check the code?",
    a: (
      <>
        MAXXAGENT is non-custodial: every transaction is built for your address and signed in your wallet, and you can verify
        each one on BaseScan. The full source code is public (MIT) on{" "}
        <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
          GitHub
        </a>
        . Tokenized stocks still carry real risks (price, liquidity, issuer, smart contract, oracle): read the{" "}
        <Link href="/terms" className="text-cyan-300 underline">
          risk disclosure
        </Link>
        . Nothing here is financial advice.
      </>
    ),
  },
  {
    q: "Something went wrong. How do I get help?",
    a: (
      <>
        Check the transaction on BaseScan first: a reverted swap returns your funds minus gas. For bugs or questions, open an
        issue on{" "}
        <a href={`${GITHUB}/issues`} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
          GitHub
        </a>
        . Never share your seed phrase: no one from MAXXAGENT will ever ask for it.
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <main className="min-h-screen bg-[#03060e] px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-8">
        <Link href="/" className="inline-block">
          <MaxxAgentLogo size={36} />
        </Link>
        <div>
          <h1 className="text-2xl font-extrabold text-white">Frequently asked questions</h1>
          <p className="text-sm text-slate-400">How MAXXAGENT works, what it costs, and what to watch out for.</p>
        </div>
        <div className="space-y-3">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group rounded-2xl border border-slate-800 bg-[#0b1120] p-4 open:border-slate-700">
              <summary className="cursor-pointer list-none text-sm font-bold text-white flex items-center justify-between gap-3">
                {q}
                <span className="text-slate-500 transition group-open:rotate-45">+</span>
              </summary>
              <div className="mt-3 text-sm leading-relaxed text-slate-300 space-y-2">{a}</div>
            </details>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          See also the{" "}
          <Link href="/terms" className="underline hover:text-slate-300">
            Terms of Use &amp; Risk Disclosure
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
