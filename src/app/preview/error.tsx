"use client";

import { useEffect } from "react";
import { MaxxAgentLogo } from "@/components/BrandLogo";

/** Read-only US preview error boundary (zero wallet or trading copy). */
export default function PreviewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("MAXXAGENT preview error", error?.digest || "");
  }, [error]);

  return (
    <main className="min-h-screen bg-[#03060e] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-3xl border border-slate-800 bg-[#0b1120] p-6 space-y-4">
        <MaxxAgentLogo size={36} />
        <h1 className="text-lg font-bold text-white">Preview temporarily unavailable</h1>
        <p className="text-sm text-slate-400">
          This read-only preview could not load live Base Mainnet data right now. Please try again in a moment.
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
