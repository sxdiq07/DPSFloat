"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SHORTCUTS: {
  section: string;
  items: { keys: string[]; label: string }[];
}[] = [
  {
    section: "Navigation",
    items: [
      { keys: ["G", "O"], label: "Overview" },
      { keys: ["G", "C"], label: "Clients" },
      { keys: ["G", "R"], label: "Reports" },
      { keys: ["G", "S"], label: "Settings" },
    ],
  },
  {
    section: "Actions",
    items: [
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["T"], label: "Toggle theme" },
      { keys: ["?"], label: "Show this panel" },
    ],
  },
];

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const [gPrimed, setGPrimed] = useState(false);
  const router = useRouter();
  const { theme, setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    const shouldIgnore = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      );
    };

    let gTimer: ReturnType<typeof setTimeout> | null = null;

    const onKey = (e: KeyboardEvent) => {
      // Command palette is handled in its own listener. Don't fight it.
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) return;

      if (shouldIgnore(e)) return;

      // ? opens help
      if (e.key === "?") {
        e.preventDefault();
        setOpen(true);
        return;
      }

      // T toggles theme
      if (e.key === "t" || e.key === "T") {
        const isDark = (theme === "system" ? resolvedTheme : theme) === "dark";
        setTheme(isDark ? "light" : "dark");
        return;
      }

      // G-prefix navigation
      if (e.key === "g" || e.key === "G") {
        setGPrimed(true);
        if (gTimer) clearTimeout(gTimer);
        gTimer = setTimeout(() => setGPrimed(false), 900);
        return;
      }
      if (gPrimed) {
        const k = e.key.toLowerCase();
        const routes: Record<string, string> = {
          o: "/",
          c: "/clients",
          r: "/reports",
          s: "/settings",
        };
        if (routes[k]) {
          e.preventDefault();
          router.push(routes[k]);
          setGPrimed(false);
          if (gTimer) clearTimeout(gTimer);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (gTimer) clearTimeout(gTimer);
    };
  }, [gPrimed, router, theme, setTheme, resolvedTheme]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[18px]">Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 pt-2">
          {SHORTCUTS.map((group) => (
            <div key={group.section}>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                {group.section}
              </div>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between"
                  >
                    <span className="text-[15px] text-ink-2">{item.label}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-1.5 font-mono text-[11px] text-ink-2"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="border-t border-subtle pt-4 text-[11.5px] text-ink-3">
            Press{" "}
            <kbd className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-1 font-mono text-[10px]">
              ?
            </kbd>{" "}
            anywhere to open this panel.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
