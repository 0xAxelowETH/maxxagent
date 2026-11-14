"use client";

import { useEffect, useState } from "react";

/**
 * Dollar amount field. Keeps its own text so the field shows exactly what was typed without
 * leading zeros: a plain controlled number input shows "04" after typing 4 into "0", because
 * React treats "04" and 4 as equal and never rewrites the field.
 */
export function UsdAmountInput({
  value,
  onChange,
  min,
  max = 10000,
  className,
  ariaLabel,
}: {
  value: number;
  onChange: (usd: number) => void;
  min?: number;
  max?: number;
  className?: string;
  ariaLabel: string;
}) {
  const [text, setText] = useState(value ? String(value) : "");

  // Follow changes made elsewhere (preset buttons, share links) without overwriting what is being typed
  useEffect(() => {
    setText((t) => ((Number(t) || 0) === value ? t : value ? String(value) : ""));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        let t = e.target.value.replace(/,/g, ".").replace(/[^\d.]/g, "");
        const dot = t.indexOf(".");
        if (dot !== -1) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, "").slice(0, 2);
        t = t.replace(/^0+(?=\d)/, "");
        setText(t);
        onChange(Math.min(max, Math.max(0, Number(t) || 0)));
      }}
      className={className}
      aria-label={ariaLabel}
      title={min ? `At least $${min.toFixed(2)}` : undefined}
    />
  );
}
