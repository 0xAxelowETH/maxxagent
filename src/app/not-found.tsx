import Link from "next/link";
import { MaxxAgentLogo } from "@/components/BrandLogo";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#03060e] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-3xl border border-slate-800 bg-[#0b1120] p-6 space-y-4">
        <MaxxAgentLogo size={36} />
        <h1 className="text-lg font-bold text-white">Page not found</h1>
        <p className="text-sm text-slate-400">This page doesn&apos;t exist. Your wallet and funds are not affected.</p>
        <div className="flex gap-2">
          <Link href="/" className="rounded-xl bg-[#4C6FFF] px-4 py-2.5 text-sm font-bold text-white hover:brightness-110">
            Back to MAXXAGENT
          </Link>
          <Link href="/faq" className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800">
            FAQ
          </Link>
        </div>
      </div>
    </main>
  );
}
