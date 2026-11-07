"use client";

import { useEffect } from "react";
import { MaxxAgentLogo } from "@/components/BrandLogo";

/** Error boundary: a friendly fallback instead of a blank screen. Never shows error details to users. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("MAXXAGENT UI error", error?.digest || "");
  }, [error]);

  return (
    <main className="min-h-screen bg-[#03060e] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-3xl border border-slate-800 bg-[#0b1120] p-6 space-y-4">
        <MaxxAgentLogo size={36} />
        <h1 className="text-lg font-bold text-white">Something went wrong</h1>
        <p className="text-sm text-slate-400">
          The page hit an unexpected error. Your funds are safe — MAXXAGENT never holds them, and nothing is sent
          without your wallet confirmation.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => reset()}
            className="rounded-xl bg-[#4C6FFF] px-4 py-2.5 text-sm font-bold text-white hover:brightness-110 cursor-pointer"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800 cursor-pointer"
          >
            Reload
          </button>
        </div>
      </div>
    </main>
  );
}
