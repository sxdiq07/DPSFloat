import Link from "next/link";
import { requireAuth } from "@/lib/session";
import { signOut } from "@/lib/auth";
import { LayoutDashboard, Users, FileBarChart, Settings, LogOut } from "lucide-react";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();

  return (
    <div className="flex min-h-screen bg-muted/20">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r bg-card">
        <div className="flex h-14 items-center border-b px-4">
          <span className="inline-flex items-center gap-2 font-semibold">
            <span className="inline-block h-6 w-6 rounded bg-primary" />
            CredFloat
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 p-2 text-sm">
          <NavLink href="/" icon={<LayoutDashboard className="h-4 w-4" />}>
            Overview
          </NavLink>
          <NavLink href="/clients" icon={<Users className="h-4 w-4" />}>
            Clients
          </NavLink>
          <NavLink href="/reports" icon={<FileBarChart className="h-4 w-4" />}>
            Reports
          </NavLink>
          <NavLink href="/settings" icon={<Settings className="h-4 w-4" />}>
            Settings
          </NavLink>
        </nav>

        <div className="border-t p-3">
          <div className="mb-2 text-xs">
            <div className="font-medium">{session.user.name ?? session.user.email}</div>
            <div className="text-muted-foreground">{session.user.role}</div>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="inline-flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6">{children}</div>
      </main>
    </div>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {icon}
      {children}
    </Link>
  );
}
