"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Users,
  FileBarChart,
  Settings,
  Search,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

export type CommandClient = { id: string; name: string };

export function CommandMenu({ clients }: { clients: CommandClient[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  return (
    <>
      <button
        aria-label="Search (⌘K)"
        onClick={() => setOpen(true)}
        className="group hidden items-center gap-2 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-3 py-1.5 text-[12.5px] text-ink-3 transition-all hover:border-[var(--color-border-hair)] hover:text-ink-2 md:inline-flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search</span>
        <kbd className="ml-4 flex items-center gap-0.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
          <span>⌘</span>K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen} title="Command palette">
        <CommandInput placeholder="Search clients, jump to pages, run actions…" />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>

          <CommandGroup heading="Navigate">
            <CommandItem onSelect={() => go("/")}>
              <LayoutDashboard />
              <span>Overview</span>
              <CommandShortcut>G O</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/clients")}>
              <Users />
              <span>Clients</span>
              <CommandShortcut>G C</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/reports")}>
              <FileBarChart />
              <span>Reports</span>
              <CommandShortcut>G R</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/settings")}>
              <Settings />
              <span>Settings</span>
              <CommandShortcut>G S</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          {clients.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Clients">
                {clients.slice(0, 40).map((c) => (
                  <CommandItem
                    key={c.id}
                    onSelect={() => go(`/clients/${c.id}`)}
                    value={c.name}
                  >
                    <Users />
                    <span>{c.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() => {
                setOpen(false);
                toast.info("Trigger reminder cron from a shell:", {
                  description:
                    "curl -H 'Authorization: Bearer <CRON_SECRET>' /api/cron/send-reminders",
                  duration: 8000,
                });
              }}
            >
              <Zap />
              <span>Trigger reminder cron</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
