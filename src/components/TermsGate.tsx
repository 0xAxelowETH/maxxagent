"use client";

import React, { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { MaxxAgentLogo } from "./BrandLogo";

export const TERMS_VERSION = "1";
export const TERMS_STORAGE_KEY = `maxxagent_terms_v${TERMS_VERSION}`;

const ITEMS: { id: string; text: React.ReactNode }[] = [
  {
    id: "jurisdiction",
    text: (
      <>
        I am <strong>not a U.S. person</strong>, not located in or a resident of a country or region sanctioned by
        the U.S. OFAC, and tokenized stocks are permitted where I live.
      </>
    ),
  },
  { id: "age", text: <>I am <strong>18 years or older</strong>.</> },
  {
    id: "advice",
    text: (
      <>
        MAXXAGENT is an informational tool. Agent proposals are <strong>not financial, investment, legal or tax
        advice</strong> and not a recommendation to buy anything.
      </>
    ),
  },
  {
    id: "risk",
    text: (
      <>
        Tokenized stocks are risky: prices can fall, DEX prices can differ from the Chainlink NAV, liquidity can be
        thin, and the tokens give <strong>no voting or shareholder rights</strong>. I can lose money.
      </>
    ),
  },
  {
    id: "custody",
    text: (
      <>
        MAXXAGENT is <strong>non-custodial</strong>: I sign every transaction from my own wallet, I am responsible for
        it, and transactions on Base cannot be reversed.
      </>
    ),
  },
  {
    id: "terms",
    text: (
      <>
        I have read and agree to the{" "}
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
          Terms of Use &amp; Risk Disclosure
        </a>
        .
      </>
    ),
  },
];

/**
 * First-visit gate: the user must tick every box before using the app.
 * Acceptance is remembered in this browser (localStorage) per terms version.
 */
export function TermsGate({ open, onAccept }: { open: boolean; onAccept: () => void }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [declined, setDeclined] = useState(false);
  const allChecked = ITEMS.every((i) => checked[i.id]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const accept = () => {
    if (!allChecked) return;
    try {
      localStorage.setItem(
        TERMS_STORAGE_KEY,
        JSON.stringify({ acceptedAt: new Date().toISOString(), version: TERMS_VERSION })
      );
    } catch {}
    onAccept();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
    >
      <div className="w-full sm:max-w-lg max-h-[100dvh] sm:max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-slate-700 bg-[#0b1120] shadow-2xl">
        <div className="px-5 pt-5 pb-3 sm:px-6 sm:pt-6 border-b border-slate-800">
          <MaxxAgentLogo size={36} />
          <h2 id="terms-gate-title" className="mt-4 text-lg font-bold text-white">
            Before you continue
          </h2>
          <p className="text-xs text-slate-400">Please confirm each statement. All are required.</p>
        </div>

        {declined ? (
          <div className="px-5 py-8 sm:px-6 text-sm text-slate-300 space-y-4">
            <p>
              Sorry — MAXXAGENT is only available to people who can confirm all of these statements. You can close this
              page.
            </p>
            <button
              onClick={() => setDeclined(false)}
              className="text-xs text-cyan-300 underline cursor-pointer"
            >
              Go back
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-2.5">
              {ITEMS.map((item) => (
                <label
                  key={item.id}
                  className={`flex items-start gap-3 rounded-2xl border p-3.5 text-[13px] leading-relaxed cursor-pointer select-none transition ${
                    checked[item.id]
                      ? "border-emerald-500/50 bg-emerald-500/10 text-slate-100"
                      : "border-slate-800 bg-[#070b14] text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!!checked[item.id]}
                    onChange={(e) => setChecked((c) => ({ ...c, [item.id]: e.target.checked }))}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-500 cursor-pointer"
                  />
                  <span>{item.text}</span>
                </label>
              ))}
            </div>

            <div className="px-5 py-4 sm:px-6 border-t border-slate-800 space-y-2.5 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                onClick={accept}
                disabled={!allChecked}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed transition cursor-pointer"
              >
                <ShieldCheck className="h-4 w-4" />
                {allChecked
                  ? "Agree and enter"
                  : `Confirm all ${ITEMS.length} statements (${ITEMS.filter((i) => checked[i.id]).length}/${ITEMS.length})`}
              </button>
              <button
                onClick={() => setDeclined(true)}
                className="w-full rounded-2xl px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
              >
                I don&apos;t agree
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
