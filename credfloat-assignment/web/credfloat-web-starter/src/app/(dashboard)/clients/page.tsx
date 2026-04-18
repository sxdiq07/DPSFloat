import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { formatINR } from "@/lib/currency";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

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
    return {
      id: c.id,
      name: c.displayName,
      status: c.status,
      outstanding,
      overdue,
      debtorCount: c.parties.length,
      lastSynced: c.updatedAt,
    };
  });

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Portfolio"
        title="Clients"
        subtitle={
          <>
            {rows.length} client {rows.length === 1 ? "company" : "companies"}{" "}
            under management. Click any row to drill into debtors and invoices.
          </>
        }
      />

      <div className="card-apple overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-8 py-20 text-center">
            <p className="text-[15px] text-ink-2">No client companies yet.</p>
            <p className="mt-1 text-[13px] text-ink-3">
              Run the Tally connector to sync data.
            </p>
          </div>
        ) : (
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                <th className="px-8 py-4 text-left font-medium">Client</th>
                <th className="px-8 py-4 text-right font-medium">
                  Outstanding
                </th>
                <th className="px-8 py-4 text-right font-medium">
                  Overdue 60+
                </th>
                <th className="px-8 py-4 text-right font-medium">Debtors</th>
                <th className="px-8 py-4 text-left font-medium">Status</th>
                <th className="px-8 py-4 text-left font-medium">Last synced</th>
                <th className="w-8 px-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr
                  key={c.id}
                  className={`row-interactive group ${i > 0 ? "border-t border-subtle" : "border-t border-subtle"}`}
                >
                  <td className="px-8 py-5">
                    <Link
                      href={`/clients/${c.id}`}
                      className="font-medium text-ink hover:text-[hsl(var(--accent-blue))]"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="tabular px-8 py-5 text-right font-medium text-ink">
                    {formatINR(c.outstanding)}
                  </td>
                  <td className="tabular px-8 py-5 text-right">
                    {c.overdue > 0 ? (
                      <span
                        className="font-medium"
                        style={{ color: "hsl(4 72% 45%)" }}
                      >
                        {formatINR(c.overdue)}
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="tabular px-8 py-5 text-right text-ink-2">
                    {c.debtorCount}
                  </td>
                  <td className="px-8 py-5">
                    <StatusPill status={c.status} />
                  </td>
                  <td className="px-8 py-5 text-ink-3">
                    {formatDistanceToNow(c.lastSynced, { addSuffix: true })}
                  </td>
                  <td className="px-4 py-5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">
                    <ChevronRight className="h-4 w-4" />
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

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string; dot: string }> = {
    ACTIVE: {
      bg: "hsl(142 60% 94%)",
      color: "hsl(142 64% 24%)",
      dot: "hsl(142 64% 42%)",
    },
    PAUSED: {
      bg: "hsl(44 100% 93%)",
      color: "hsl(32 80% 30%)",
      dot: "hsl(32 100% 52%)",
    },
    ARCHIVED: {
      bg: "hsl(240 9% 92%)",
      color: "hsl(240 3% 36%)",
      dot: "hsl(240 3% 60%)",
    },
  };
  const s = styles[status] ?? styles.ARCHIVED;
  return (
    <span
      className="pill"
      style={{ background: s.bg, color: s.color }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: s.dot }}
      />
      {status.toLowerCase()}
    </span>
  );
}
