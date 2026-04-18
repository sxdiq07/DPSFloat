import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { formatINR } from "@/lib/currency";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const firmId = await requireFirmId();

  const clients = await prisma.clientCompany.findMany({
    where: { firmId },
    include: {
      parties: { select: { id: true } },
      invoices: {
        where: { status: "OPEN" },
        select: { outstandingAmount: true, ageBucket: true },
      },
    },
    orderBy: { displayName: "asc" },
  });

  const rows = clients.map((c) => {
    const outstanding = c.invoices.reduce(
      (sum, i) => sum + Number(i.outstandingAmount),
      0,
    );
    const overdue = c.invoices
      .filter(
        (i) => i.ageBucket === "DAYS_60_90" || i.ageBucket === "DAYS_90_PLUS",
      )
      .reduce((sum, i) => sum + Number(i.outstandingAmount), 0);
    const lastSynced = c.updatedAt;
    return {
      id: c.id,
      name: c.displayName,
      status: c.status,
      outstanding,
      overdue,
      debtorCount: c.parties.length,
      lastSynced,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} client companies under management
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            No client companies yet. Run the Tally connector to sync data.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Client</th>
                <th className="px-6 py-3 text-right font-medium">Outstanding</th>
                <th className="px-6 py-3 text-right font-medium">Overdue 60+</th>
                <th className="px-6 py-3 text-right font-medium">Debtors</th>
                <th className="px-6 py-3 text-left font-medium">Status</th>
                <th className="px-6 py-3 text-left font-medium">Last synced</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-6 py-3">
                    <Link
                      href={`/clients/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">
                    {formatINR(c.outstanding)}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums text-red-700">
                    {c.overdue > 0 ? formatINR(c.overdue) : "—"}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">
                    {c.debtorCount}
                  </td>
                  <td className="px-6 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">
                    {formatDistanceToNow(c.lastSynced, { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-900 border-emerald-200",
    PAUSED: "bg-amber-100 text-amber-900 border-amber-200",
    ARCHIVED: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs ${
        styles[status] ?? styles.ARCHIVED
      }`}
    >
      {status.toLowerCase()}
    </span>
  );
}
