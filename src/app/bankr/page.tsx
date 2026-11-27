import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { miniappEmbedTags } from "@/lib/miniappEmbed";
import { BANKR_DESCRIPTION, BANKR_TITLE, SITE_URL, ogPaths } from "@/lib/siteMeta";

export const metadata: Metadata = {
  title: BANKR_TITLE,
  description: BANKR_DESCRIPTION,
  alternates: { canonical: "/bankr" },
  openGraph: {
    type: "website",
    siteName: "MAXXAGENT",
    url: "/bankr",
    title: BANKR_TITLE,
    description: BANKR_DESCRIPTION,
    images: [{ url: ogPaths.bankr.card, width: 1200, height: 630, alt: "Ask Bankr, get a stock basket: the MAXXAGENT Baskets skill" }],
  },
  twitter: { card: "summary_large_image", title: BANKR_TITLE, description: BANKR_DESCRIPTION, images: [ogPaths.bankr.card] },
  other: miniappEmbedTags({ siteUrl: SITE_URL, path: "/bankr", buttonTitle: "Use it in Bankr", imageUrl: `${SITE_URL}${ogPaths.bankr.tall}` }),
};

const SKILL_URL = "https://github.com/0xAxelowETH/maxxagent/tree/main/bankr-skill/maxxagent-baskets";
const SKILL_FILE = "https://github.com/0xAxelowETH/maxxagent/blob/main/bankr-skill/maxxagent-baskets/SKILL.md";
const PR_URL = "https://github.com/BankrBot/skills/pull/874";
const tryOnSite = (prompt: string) => `/?tab=agent&prompt=${encodeURIComponent(prompt)}`;

const EXAMPLES: { ask: string; does: string; href?: string; cta?: string }[] = [
  { ask: "build me a basket: AI and cloud, anything but Tesla, cap each at 30%, keep 10% in cash", does: "Leaves Tesla out, keeps every stock at or under 30% and 10% in USDC." },
  { ask: "split $200 across big tech, a safe, low volatility basket", does: "Reads “safe” as conservative: stocks above 60% volatility a year stay out. The buy link fills in $200." },
  { ask: "only Apple and Microsoft, 50/50", does: "Exactly those two, half each." },
  { ask: "aggressive growth, maximum upside", does: "Leans into higher volatility and the fastest revenue growth from SEC filings." },
  { ask: "what do tokenized NVDA and TSLA cost on Base right now?", does: "Live Chainlink NAV, the 24/7 price on Base and the 24h move.", href: "/stock/NVDAc", cta: "See NVDAc here →" },
];

// `pre`: keep line breaks and scroll sideways on phones instead of wrapping (aligned API listings)
const Code = ({ children, pre }: { children: React.ReactNode; pre?: boolean }) => (
  <code
    className={`block select-all rounded-xl border border-slate-700/80 bg-[#050b18] px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-cyan-200 ${
      pre ? "overflow-x-auto whitespace-pre" : "whitespace-pre-wrap break-words"
    }`}
  >
    {children}
  </code>
);

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-5 space-y-3">
    <h2 className="flex items-center gap-3 text-base font-extrabold text-white">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#4C6FFF] to-cyan-500 text-sm">{n}</span>
      {title}
    </h2>
    <div className="text-sm leading-relaxed text-slate-300 space-y-3">{children}</div>
  </section>
);

export default function BankrPage() {
  return (
    <main className="min-h-screen bg-[#02050c] bg-cyber-grid px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <SiteNav />
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-cyan-300">
            <img src="/logos/partners/bankr.svg" alt="Bankr" className="h-4 w-4 rounded" />
            Bankr skill · MAXXAGENT Baskets
          </p>
          <h1 className="text-2xl font-extrabold text-white">Use MAXXAGENT in Bankr</h1>
          <p className="text-sm leading-relaxed text-slate-400">
            Ask your Bankr agent for a basket of Coinbase tokenized stocks in plain English. The same rule-based agent as the
            Agent tab builds it: weights, the reason for each pick, the limits it kept, and every number with its source. You
            buy it here, from your own wallet. No API key, no account, nothing to sign in Bankr.
          </p>
        </div>

        <section className="rounded-2xl border border-cyan-900/60 bg-cyan-950/20 p-5">
          <h2 className="text-sm font-extrabold text-white">How it works</h2>
          <ol className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
            <li className="rounded-xl border border-slate-800 bg-[#0b1120] p-3"><b className="text-white">1. You ask Bankr</b> in your own words.</li>
            <li className="rounded-xl border border-slate-800 bg-[#0b1120] p-3"><b className="text-white">2. Bankr calls MAXXAGENT</b>, which reads Chainlink NAV, volatility, Base liquidity and SEC filings.</li>
            <li className="rounded-xl border border-slate-800 bg-[#0b1120] p-3"><b className="text-white">3. You get the basket</b>, the limits it kept, what it left out and why, with sources.</li>
            <li className="rounded-xl border border-slate-800 bg-[#0b1120] p-3"><b className="text-white">4. You open the link</b> and review the prices on MAXXAGENT, then sign from your own wallet.</li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">The skill never trades and never holds funds. Buying always happens on maxxagent.xyz, where you sign every transaction.</p>
        </section>

        <Step n={1} title="Install the skill (once)">
          <p>Send this message to your Bankr agent:</p>
          <Code>install the skill from {SKILL_URL}</Code>
          <p className="text-xs text-slate-500">
            It&apos;s also{" "}
            <a href={PR_URL} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
              in review for the Bankr skills catalog
            </a>
            ; until then, install it from the link above.
          </p>
        </Step>

        <Step n={2} title="Ask for a basket">
          <p>Write what you want, like you would to a person. A few examples (each one also works in the Agent tab here, no wallet needed):</p>
          <p className="text-xs text-slate-400">
            If part of a request can&apos;t be followed (a stock outside the 10, or more than 90% kept in cash), Bankr tells you
            what and asks how to continue before offering a buy link.
          </p>
          <ul className="space-y-2.5">
            {EXAMPLES.map((e) => (
              <li key={e.ask} className="rounded-xl border border-slate-800 bg-[#050b18] p-3">
                <p className="font-mono text-[12.5px] text-cyan-200">“{e.ask}”</p>
                <p className="mt-1.5 text-xs text-slate-400">
                  {e.does}{" "}
                  <Link href={e.href ?? tryOnSite(e.ask)} className="whitespace-nowrap text-cyan-300 underline">
                    {e.cta ?? "Try it here →"}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </Step>

        <Step n={3} title="Refine it">
          <p>
            Keep talking: <em>“replace Microsoft with Apple”</em>, <em>“drop Meta”</em>, <em>“cap each at 25%”</em>. Bankr sends
            your changes as follow-ups to the same basket, in order, so earlier limits still hold.
          </p>
        </Step>

        <Step n={4} title="Buy it from your own wallet">
          <p>
            Bankr&apos;s answer ends with a <b className="text-white">MAXXAGENT Basket</b> link. It opens this site with the basket
            loaded (and your amount filled in, if you gave one). You see the prices, the guaranteed minimum and the cost vs NAV,
            then confirm in your wallet. Any USDC you asked to keep simply stays in your wallet.
          </p>
          <p className="text-xs text-slate-500">
            Tokenized stocks are only for eligible persons outside the United States. Proposals are rule-based, not financial
            advice.
          </p>
        </Step>

        <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-5 space-y-3 text-sm text-slate-300">
          <h2 className="text-base font-extrabold text-white">For developers and other agents</h2>
          <p>Two public, read-only endpoints. No key; about 20 basket requests a minute per IP.</p>
          <Code pre>{`GET https://maxxagent.xyz/api/skill/basket
  ?prompt=AI and cloud, no Tesla, max 30% each   (required)
  &amount=200                                      (optional, USD)
  &risk=Conservative|Balanced|Aggressive           (optional)
  &then=replace Microsoft with Apple               (optional, repeatable)

GET https://maxxagent.xyz/api/skill/stocks         (live prices of the 10 stocks)`}</Code>
          <p>
            The basket answer has <code className="text-cyan-200">basket</code>, <code className="text-cyan-200">cashKeptInUsdcPct</code>,{" "}
            <code className="text-cyan-200">limits</code>, <code className="text-cyan-200">leftOut</code>, <code className="text-cyan-200">facts</code> (with
            sources), <code className="text-cyan-200">buyUrl</code> and a <code className="text-cyan-200">notice</code> to show. The full instructions
            the agent follows are in{" "}
            <a href={SKILL_FILE} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
              SKILL.md
            </a>{" "}
            (open source, MIT).
          </p>
        </section>

        <p className="text-xs text-slate-500">
          Questions? See the{" "}
          <Link href="/faq" className="underline hover:text-slate-300">
            FAQ
          </Link>{" "}
          or the{" "}
          <Link href="/terms" className="underline hover:text-slate-300">
            Terms &amp; Risk Disclosure
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
