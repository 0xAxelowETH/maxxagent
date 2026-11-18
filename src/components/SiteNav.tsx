import Link from "next/link";
import { MaxxAgentLogo } from "./BrandLogo";
import { ThemeToggle } from "./ThemeToggle";

/** Shared top navigation for the content pages (stats, verify, FAQ, terms, stock and index pages). */
export function SiteNav({ current }: { current?: "stats" | "verify" | "faq" | "terms" }) {
  const links: { href: string; label: string; key: string }[] = [
    { href: "/stats", label: "Live stats", key: "stats" },
    { href: "/verify", label: "Verify", key: "verify" },
    { href: "/faq", label: "FAQ", key: "faq" },
  ];
  return (
    <nav className="flex items-center justify-between gap-3" aria-label="Site">
      <Link href="/" className="inline-block shrink-0" aria-label="MAXXAGENT home">
        <MaxxAgentLogo size={32} />
      </Link>
      <div className="flex items-center gap-1 sm:gap-2 text-xs">
        {links.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            aria-current={current === l.key ? "page" : undefined}
            className={`hidden sm:inline-flex min-h-[38px] items-center rounded-lg px-3 py-2 font-semibold transition ${
              current === l.key ? "bg-slate-800/90 text-white border border-slate-700/80" : "text-slate-400 hover:text-white hover:bg-slate-800/50"
            }`}
          >
            {l.label}
          </Link>
        ))}
        <ThemeToggle />
        <Link
          href="/"
          className="inline-flex min-h-[38px] items-center rounded-xl bg-gradient-to-r from-[#4C6FFF] to-cyan-600 px-3.5 py-2 font-bold text-white shadow-lg shadow-[#4C6FFF]/25 hover:brightness-110"
        >
          Open app
        </Link>
      </div>
    </nav>
  );
}
