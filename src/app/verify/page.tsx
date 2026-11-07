import type { Metadata } from "next";
import Link from "next/link";
import { MaxxAgentLogo } from "@/components/BrandLogo";
import { toErc8021DataSuffix } from "@/lib/builderCode";

export const metadata: Metadata = {
  title: "How to verify — MAXXAGENT",
  description:
    "How to check MAXXAGENT's onchain activity yourself: Builder Code attribution, the KyberSwap source tag, live stats, safety guards and the open-source code.",
  alternates: { canonical: "/verify" },
};

const GITHUB = "https://github.com/0xAxelowETH/maxxagent";
const BUILDER_CODE = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";
const ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const TEAM_WALLET = "0xD986C711F575C71dA22Bd08742b9DB2091Ba9e33";
const REGISTRY = process.env.NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS || "";

const a = "text-cyan-300 underline break-all";
const code = "rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[12px] text-slate-200 break-all";

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-5 space-y-3">
      <h2 className="text-base font-bold text-white">
        <span className="mr-2 font-mono text-cyan-300">{n}.</span>
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

export default function VerifyPage() {
  const suffix = toErc8021DataSuffix([BUILDER_CODE]).dataSuffix;
  return (
    <main className="min-h-screen bg-[#03060e] px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/" className="inline-block">
          <MaxxAgentLogo size={36} />
        </Link>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-white">How to verify MAXXAGENT</h1>
          <p className="text-sm text-slate-400">
            Everything MAXXAGENT does happens onchain on Base and can be checked without trusting us: which trades it
            routed, that each one is attributed, and how funds stay in the user&apos;s wallet.
          </p>
        </div>

        <Section n={1} title="What it is">
          <p>
            A non-custodial app for Coinbase tokenized stocks (B20 tokens) on Base. Users build their own stock index
            or get one proposed by a rule-based agent (live Chainlink NAV, DEX prices, liquidity), then buy the whole
            basket from their own wallet in one confirmation, pay with USDC or ETH, share it as a link, track P/L and
            rebalance. MAXXAGENT never holds funds, keys or approvals beyond the exact amount of each swap.
          </p>
          <p>
            Built for the Stocks Maxxing Season, tracks <em>Programmable Stock Markets</em> and{" "}
            <em>Agentic Stock Finance</em>.
          </p>
        </Section>

        <Section n={2} title="Every trade is tagged twice, onchain">
          <p>
            <strong className="text-white">Builder Code (ERC-8021).</strong> Every transaction MAXXAGENT builds ends with
            the Base Builder Code <code className={code}>{BUILDER_CODE}</code>. On BaseScan, open a transaction → &quot;More
            details&quot; → Input Data (original): it ends with
          </p>
          <p>
            <code className={code}>{suffix.slice(2)}</code>
          </p>
          <p>
            (the code&apos;s bytes, its length, schema 0 and the ERC-8021 marker <code className={code}>8021…8021</code>
            ). It is aligned to 32 bytes so it stays at the very end inside smart-wallet batches (EIP-7702 / ERC-4337),
            and smart wallets also receive it through the EIP-5792 <code className={code}>dataSuffix</code> capability.
          </p>
          <p>
            <strong className="text-white">Router source tag.</strong> Swaps go through KyberSwap&apos;s router on Base{" "}
            <a className={a} href={`https://basescan.org/address/${ROUTER}`} target="_blank" rel="noopener noreferrer">
              {ROUTER}
            </a>{" "}
            with <code className={code}>source = maxxagent</code>. The router emits a <code className={code}>ClientData</code>{" "}
            event containing <code className={code}>{`"Source":"maxxagent"`}</code> and the trade&apos;s USD value, next to
            its <code className={code}>Swapped</code> event (wallet, tokens, amounts). Look for both in a transaction&apos;s
            Logs tab.
          </p>
        </Section>

        <Section n={3} title="Live usage, computed from the chain">
          <p>
            <Link href="/stats" className={a}>
              /stats
            </Link>{" "}
            scans the router&apos;s <code className={code}>ClientData</code> logs for the <code className={code}>maxxagent</code>{" "}
            tag, reads each trade&apos;s <code className={code}>Swapped</code> event and transaction input, and shows trades,
            volume, unique wallets and the share carrying the Builder Code, with a BaseScan link per trade.
          </p>
          <p>
            The team&apos;s own test wallet{" "}
            <a className={a} href={`https://basescan.org/address/${TEAM_WALLET}`} target="_blank" rel="noopener noreferrer">
              {TEAM_WALLET}
            </a>{" "}
            is excluded, so the numbers only count other people. We never trade to inflate them.
          </p>
          <p>
            To check one wallet from a terminal: <code className={code}>npm run verify:trades -- --wallet=0x… --hours=72</code>{" "}
            reads that wallet&apos;s trades the way indexers do (transaction input for normal and EIP-7702 wallets, the
            UserOperation inside <code className={code}>EntryPoint.handleOps</code> for ERC-4337 smart wallets).
          </p>
        </Section>

        <Section n={4} title="How a purchase works (non-custodial)">
          <ol className="list-decimal pl-5 space-y-1">
            <li>The browser asks <code className={code}>/api/swap</code> for a route for the user&apos;s own address.</li>
            <li>
              The server gets a KyberSwap route and refuses it if the router is not the whitelisted one, the cost is above
              1.5%, or the price is more than 5% worse than the Chainlink NAV. It appends the Builder Code. It never sees
              a key.
            </li>
            <li>
              The user sees a review (estimate, guaranteed minimum, cost vs NAV, slippage 0.3–1%) and only then the
              wallet opens: an exact-amount approval (none for ETH) and the swap, batched in one prompt when supported.
            </li>
            <li>Stock tokens go straight to the user&apos;s wallet; the app reads what actually arrived from the receipts.</li>
          </ol>
          <p>
            Guards against double trades: if a wallet errors after a batch may have been sent, the app compares token
            balances and the nonce before sending anything again.
          </p>
        </Section>

        <Section n={5} title="Index registry">
          {REGISTRY ? (
            <p>
              Published indexes live in <code className={code}>StockMaxxIndexRegistry</code> at{" "}
              <a className={a} href={`https://basescan.org/address/${REGISTRY}#code`} target="_blank" rel="noopener noreferrer">
                {REGISTRY}
              </a>
              . It stores names and weights only: no deposits, no payable functions, no token transfers, no fees. Only
              an index&apos;s creator can change its weights. Source verified on BaseScan and Sourcify.
            </p>
          ) : (
            <p>
              The contract <code className={code}>StockMaxxIndexRegistry</code> (names and weights only: no deposits, no
              payable functions, no token transfers, no fees) is in the repository with its test suite; it is not
              deployed yet, so indexes are shared as links for now.
            </p>
          )}
        </Section>

        <Section n={6} title="Open source">
          <p>
            All code is public (MIT) on{" "}
            <a className={a} href={GITHUB} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            . Where to look:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <code className={code}>src/app/api/swap/route.ts</code>: routing, NAV guard, router whitelist, Builder Code
            </li>
            <li>
              <code className={code}>src/lib/basketExecutor.ts</code>: review, batching, fallbacks and double-send guards
            </li>
            <li>
              <code className={code}>src/app/api/stats/route.ts</code>: how /stats counts trades
            </li>
            <li>
              <code className={code}>contracts/StockMaxxIndexRegistry.sol</code>: the index registry
            </li>
            <li>
              <code className={code}>scripts/e2e.mjs</code>: user-journey tests with a read-only mock wallet
            </li>
          </ul>
        </Section>

        <p className="text-xs text-slate-500">
          Not affiliated with, endorsed or sponsored by Coinbase, Base, Chainlink, KyberSwap or any Stocks Maxxing
          partner. See the{" "}
          <Link href="/faq" className="underline hover:text-slate-300">
            FAQ
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="underline hover:text-slate-300">
            Terms &amp; Risk Disclosure
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
