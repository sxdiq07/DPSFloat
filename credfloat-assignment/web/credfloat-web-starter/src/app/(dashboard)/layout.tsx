import Link from "next/link";
import { requireAuth } from "@/lib/session";
import { signOut } from "@/lib/auth";
import { NavLinks } from "./_components/nav-links";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();

  return (
    <div className="min-h-screen bg-surface">
      {/* Frosted sticky top nav */}
      <header className="glass sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-8 px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink"
          >
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-[hsl(211_100%_44%)] to-[hsl(211_100%_55%)] shadow-apple-sm"
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
            CredFloat
          </Link>

          <NavLinks />

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-[13px] font-medium leading-tight text-ink">
                {session.user.name ?? session.user.email}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-ink-3">
                {session.user.role}
              </div>
            </div>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(211_100%_44%)] to-[hsl(280_70%_55%)] text-[12px] font-semibold text-white"
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
        © {new Date().getFullYear()} DPS &amp; Co · CredFloat
      </footer>
    </div>
  );
}
