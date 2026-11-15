/**
 * Loading indicator in the brand's own motion: the rising "M" draws itself and the agent node pulses, the same
 * animation as the promo GIF. Respects prefers-reduced-motion (then it stays still). Works in server and client
 * components (no hooks; gradient ids are fixed but identical everywhere, so duplicates are harmless).
 */
export function MaxxLoader({ label, size = 28, className = "" }: { label?: string; size?: number; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={`inline-flex items-center gap-2.5 text-xs text-slate-400 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="maxx-loader-line" x1="14" y1="48" x2="52" y2="14" gradientUnits="userSpaceOnUse">
            <stop stopColor="#38BDF8" />
            <stop offset="0.55" stopColor="#6366F1" />
            <stop offset="1" stopColor="#34D399" />
          </linearGradient>
        </defs>
        <rect x="2.5" y="2.5" width="59" height="59" rx="15.5" fill="#0A1530" stroke="#38BDF8" strokeOpacity="0.28" />
        <path d="M15 46V24L32 40L49 17V46" stroke="#1E293B" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path
          className="maxx-draw"
          pathLength={100}
          d="M15 46V24L32 40L49 17V46"
          stroke="url(#maxx-loader-line)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className="maxx-node" cx="49" cy="17" r="5" fill="#34D399" />
      </svg>
      {label && <span>{label}</span>}
    </span>
  );
}
