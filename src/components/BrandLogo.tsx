"use client";

import React, { useId } from "react";

/**
 * MAXXAGENT brand mark: a rising "M" (growth line) whose peak is an agent node.
 * Original artwork — intentionally distinct from Base / Coinbase branding.
 */
export function MaxxAgentMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="MAXXAGENT"
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="6" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0E2350" />
          <stop offset="1" stopColor="#050A18" />
        </linearGradient>
        <linearGradient id={`${id}-line`} x1="14" y1="48" x2="52" y2="14" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38BDF8" />
          <stop offset="0.55" stopColor="#6366F1" />
          <stop offset="1" stopColor="#34D399" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(49 17) scale(11)">
          <stop stopColor="#34D399" stopOpacity="0.55" />
          <stop offset="1" stopColor="#34D399" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${id}-bg)`} />
      <rect x="2.5" y="2.5" width="59" height="59" rx="15.5" stroke="#38BDF8" strokeOpacity="0.28" />
      {/* rising M: right peak higher = growth */}
      <path
        d="M15 46V24L32 40L49 17V46"
        stroke={`url(#${id}-line)`}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* agent node */}
      <circle cx="49" cy="17" r="11" fill={`url(#${id}-glow)`} />
      <circle cx="49" cy="17" r="5" fill="#34D399" />
      <circle cx="49" cy="17" r="2" fill="#ECFDF5" />
    </svg>
  );
}

/** Mark + wordmark lockup. */
export function MaxxAgentLogo({
  size = 40,
  tagline,
  className = "",
}: {
  size?: number;
  tagline?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <MaxxAgentMark size={size} className="shrink-0 drop-shadow-[0_8px_24px_rgba(56,189,248,0.25)]" />
      <div className="leading-tight">
        <div className="text-xl font-extrabold tracking-tight">
          <span className="text-white">MAXX</span>
          <span className="bg-gradient-to-r from-sky-400 via-indigo-400 to-emerald-400 bg-clip-text text-transparent">
            AGENT
          </span>
        </div>
        {tagline && <p className="hidden sm:block text-xs font-medium text-slate-400">{tagline}</p>}
      </div>
    </div>
  );
}
