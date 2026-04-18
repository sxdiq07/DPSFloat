"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <button
        aria-label="Toggle theme"
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3"
      >
        <Sun className="h-4 w-4" />
      </button>
    );
  }

  const isDark = (theme === "system" ? resolvedTheme : theme) === "dark";

  return (
    <button
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="group flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-[var(--color-surface-2)] hover:text-ink"
    >
      <span className="relative h-4 w-4">
        <Sun
          className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"}`}
        />
        <Moon
          className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"}`}
        />
      </span>
    </button>
  );
}
