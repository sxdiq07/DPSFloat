import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { formatINR } from "@/lib/currency";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";
import { ClientsTable } from "./_components/clients-table";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const session = await requireAuth();
  const firmId = await requireFirmId();
  const { q, status } = await searchParams;

  const savedViews = await prisma.savedView.findMany({
    where: { ownerId: session.user.id, path: "/clients" },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, name: true, params: true },
  });

  // Single companies query (scoped by firm + filters). Invoice aggregates
  // are computed in SQL per-client, not by hydrating every invoice in JS.
  const companies = await prisma.clientCompany.findMany({
    where: {
      firmId,
      ...(q
        ? {
            displayName: { contains: q, mode: "insensitive" as const },
          }
        : {}),
      ...(status && status !== "all"
        ? { status: status.toUpperCase() as "ACTIVE" | "PAUSED" | "ARCHIVED" }
        : {}),
    },
    select: {
      id: true,
      displayName: true,
      status: true,
      updatedAt: true,
      _count: { select: { parties: true } },
    },
    orderBy: { displayName: "asc" },
  });

  const ids = companies.map((c) => c.id);

  const [totals, overdueTotals] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["clientCompanyId"],
      where: { clientCompanyId: { in: ids }, status: "OPEN" },
      _sum: { outstandingAmount: true },
    }),
    prisma.invoice.groupBy({
      by: ["clientCompanyId"],
      where: {
        clientCompanyId: { in: ids },
        status: "OPEN",
        ageBucket: { in: ["DAYS_60_90", "DAYS_90_PLUS"] },
      },
      _sum: { outstandingAmount: true },
    }),
  ]);

  const totalById = new Map(
    totals.map((t) => [t.clientCompanyId, Number(t._sum.outstandingAmount ?? 0)]),
  );
  const overdueById = new Map(
    overdueTotals.map((t) => [
      t.clientCompanyId,
      Number(t._sum.outstandingAmount ?? 0),
    ]),
  );

  const rows = companies.map((c) => ({
    id: c.id,
    name: c.displayName,
    status: c.status,
    outstanding: totalById.get(c.id) ?? 0,
    overdue: overdueById.get(c.id) ?? 0,
    debtorCount: c._count.parties,
    lastSynced: formatDistanceToNow(c.updatedAt, { addSuffix: true }),
    outstandingFormatted: formatINR(totalById.get(c.id) ?? 0),
    overdueFormatted:
      (overdueById.get(c.id) ?? 0) > 0
        ? formatINR(overdueById.get(c.id) ?? 0)
        : null,
  }));

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Portfolio"
        title="Clients"
        subtitle={
          <>
            {rows.length} client {rows.length === 1 ? "company" : "companies"}
            {q || (status && status !== "all")
              ? " matching current filters"
              : " under management"}
            . Click any row to drill into debtors and invoices.
          </>
        }
      />

      <ClientsTable
        rows={rows}
        initialQuery={q ?? ""}
        initialStatus={status ?? "all"}
        savedViews={savedViews}
      />
    </div>
  );
}
