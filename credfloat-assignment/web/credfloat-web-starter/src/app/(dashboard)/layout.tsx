import Link from "next/link";
import { requireAuth, requireFirmId } from "@/lib/session";
import { signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NavLinks } from "./_components/nav-links";
import { CommandMenu } from "./_components/command-menu";
import { SyncHealthDot } from "./_components/sync-health-dot";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();
  const firmId = await requireFirmId();

  // Clients for the ⌘K palette + last-sync for the health dot.
  const [clients, lastSync] = await Promise.all([
    prisma.clientCompany.findMany({
      where: { firmId },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.party.findFirst({
      where: { clientCompany: { firmId } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
  ]);

  return (
    <div className="min-h-screen bg-surface">
      <header className="glass sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-8 px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-ink"
          >
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg"
              style={{
                background:
                  "linear-gradient(135deg, #0a84ff 0%, #0071e3 50%, #0040dd 100%)",
                boxShadow:
                  "0 2px 8px -2px rgba(0,113,227,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
              }}
              aria-hidden
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 7c0-1.1.9-2 2-2h10l4 4v8c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V7z"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>Ledger</span>
            <SyncHealthDot
              lastSyncedAt={lastSync?.lastSyncedAt?.toISOString() ?? null}
            />
          </Link>

          <NavLinks />

          <div className="ml-auto flex items-center gap-2">
            <CommandMenu
              clients={clients.map((c) => ({ id: c.id, name: c.displayName }))}
            />
            <ThemeToggle />

            <div className="ml-2 hidden text-right sm:block">
              <div className="text-[13px] font-medium leading-tight text-ink">
                {session.user.name ?? session.user.email}
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                {session.user.role}
              </div>
            </div>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#0a84ff] to-[#bf5af2] text-[12px] font-semibold text-white"
              aria-hidden
            >
              {(session.user.name ?? session.user.email ?? "?")
                .charAt(0)
                .toUpperCase()}
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button type="submit" className="btn-apple-ghost h-8 px-3">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="fade-in-up">{children}</div>
      </main>

      <footer className="mx-auto mt-16 max-w-7xl px-6 pb-10 text-[12px] text-ink-3">
        © {new Date().getFullYear()} DPS &amp; Co · Ledger · Press{" "}
        <kbd className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-1.5 py-0.5 font-mono text-[10px]">
          ⌘K
        </kbd>{" "}
        to search
      </footer>
    </div>
  );
}
