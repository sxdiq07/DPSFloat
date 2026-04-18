import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const firmId = await requireFirmId();

  const [firm, staff, clientCount, partyCount, lastSync] = await Promise.all([
    prisma.firm.findUnique({ where: { id: firmId } }),
    prisma.firmStaff.findMany({
      where: { firmId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.clientCompany.count({ where: { firmId } }),
    prisma.party.count({
      where: { clientCompany: { firmId } },
    }),
    prisma.party.findFirst({
      where: { clientCompany: { firmId } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Firm info and sync health</p>
      </div>

      <section className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Firm</h2>
        <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="mt-0.5 font-medium">{firm?.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Firm ID</dt>
            <dd className="mt-0.5 font-mono text-xs">{firm?.id}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Sync health</h2>
        <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Client companies synced</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums">
              {clientCount}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Parties synced</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums">
              {partyCount}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last sync</dt>
            <dd className="mt-0.5 text-sm font-medium">
              {lastSync?.lastSyncedAt
                ? formatDistanceToNow(lastSync.lastSyncedAt, { addSuffix: true })
                : "Never"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Staff</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-6 py-3 text-left font-medium">Name</th>
              <th className="px-6 py-3 text-left font-medium">Email</th>
              <th className="px-6 py-3 text-left font-medium">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {staff.map((s) => (
              <tr key={s.id}>
                <td className="px-6 py-3 font-medium">{s.name}</td>
                <td className="px-6 py-3 text-muted-foreground">{s.email}</td>
                <td className="px-6 py-3">
                  <span className="inline-block rounded border bg-muted px-2 py-0.5 text-xs">
                    {s.role}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
