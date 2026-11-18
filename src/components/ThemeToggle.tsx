"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "maxxagent_theme";

function applyTheme(theme: "dark" | "light") {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f4f7fc" : "#03060e");
}

/**
 * Light/Dark theme switcher persisted in localStorage (`maxxagent_theme`).
 * Defaults to `"dark"` to preserve the institutional terminal aesthetic with zero hydration mismatch.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      const next = saved === "light" ? "light" : "dark";
      setTheme(next);
      applyTheme(next);
    } catch {
      // ignore storage access issues
    }
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage issues
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={`inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl border border-slate-700/80 bg-[#0b1120] text-slate-300 hover:border-[#4C6FFF]/60 hover:text-white transition cursor-pointer ${className}`}
    >
      {theme === "dark" ? <Sun className="h-4 w-4 text-amber-300" /> : <Moon className="h-4 w-4 text-[#4C6FFF]" />}
    </button>
  );
}
