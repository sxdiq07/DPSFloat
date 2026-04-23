import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { formatINR } from "@/lib/currency";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";
import { ClientsTable } from "./_components/clients-table";
import { scoreClient, type Grade } from "@/lib/scoring";

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

  // 6-month sparkline window — sum of receipts per calendar month per client
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [
    totals,
    overdueTotals,
    trendReceipts,
    topDebtorByClient,
    promiseStatsByClient,
  ] = await Promise.all([
    // Per-client due — sum of that client's debtors' positive ledger
    // balances (the actual money owed to each firm client).
    prisma.party.groupBy({
      by: ["clientCompanyId"],
      where: {
        clientCompanyId: { in: ids },
        closingBalance: { gt: 0 },
        deletedAt: null,
      },
      _sum: { closingBalance: true },
    }),
    // 60-90 / 90+ overdue slice stays invoice-based — those buckets
    // only exist at bill level.
    prisma.invoice.groupBy({
      by: ["clientCompanyId"],
      where: {
        clientCompanyId: { in: ids },
        status: "OPEN",
        ageBucket: { in: ["DAYS_60_90", "DAYS_90_PLUS"] },
        deletedAt: null,
      },
      _sum: { outstandingAmount: true },
    }),
    prisma.receipt.findMany({
      where: {
        clientCompanyId: { in: ids },
        receiptDate: { gte: sixMonthsAgo },
      },
      select: { clientCompanyId: true, receiptDate: true, amount: true },
    }),
    // Top debtor's outstanding per client — for concentration-risk
    // factor in the client-level grade.
    prisma.party.groupBy({
      by: ["clientCompanyId"],
      where: {
        clientCompanyId: { in: ids },
        closingBalance: { gt: 0 },
        deletedAt: null,
      },
      _max: { closingBalance: true },
    }),
    // Promise kept/broken counts per client — for promise-keep-rate.
    prisma.$queryRaw<
      Array<{ clientCompanyId: string; status: string; count: bigint }>
    >`
      SELECT p."clientCompanyId" AS "clientCompanyId",
             pr."status"        AS "status",
             COUNT(*)            AS "count"
      FROM "PromiseToPay" pr
      JOIN "Party" p ON p."id" = pr."partyId"
      WHERE p."clientCompanyId" = ANY(${ids})
        AND pr."status" IN ('KEPT', 'BROKEN')
      GROUP BY p."clientCompanyId", pr."status"
    `,
  ]);

  // Zero-fill 6 month keys in ascending order
  const monthKeys: string[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(sixMonthsAgo);
    d.setMonth(d.getMonth() + i);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const sparkByClient = new Map<string, number[]>();
  for (const id of ids) sparkByClient.set(id, monthKeys.map(() => 0));
  for (const r of trendReceipts) {
    const d = new Date(r.receiptDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const idx = monthKeys.indexOf(key);
    if (idx === -1) continue;
    const arr = sparkByClient.get(r.clientCompanyId);
    if (arr) arr[idx] += Number(r.amount);
  }

  const totalById = new Map(
    totals.map((t) => [t.clientCompanyId, Number(t._sum.closingBalance ?? 0)]),
  );
  const overdueById = new Map(
    overdueTotals.map((t) => [
      t.clientCompanyId,
      Number(t._sum.outstandingAmount ?? 0),
    ]),
  );
  const topDebtorById = new Map(
    topDebtorByClient.map((t) => [
      t.clientCompanyId,
      Number(t._max.closingBalance ?? 0),
    ]),
  );
  const promisesById = new Map<string, { kept: number; broken: number }>();
  for (const row of promiseStatsByClient) {
    const entry = promisesById.get(row.clientCompanyId) ?? {
      kept: 0,
      broken: 0,
    };
    if (row.status === "KEPT") entry.kept = Number(row.count);
    if (row.status === "BROKEN") entry.broken = Number(row.count);
    promisesById.set(row.clientCompanyId, entry);
  }

  const rows = companies.map((c) => {
    const outstanding = totalById.get(c.id) ?? 0;
    const overdue = overdueById.get(c.id) ?? 0;
    const topDebtor = topDebtorById.get(c.id) ?? 0;
    const promises = promisesById.get(c.id) ?? { kept: 0, broken: 0 };
    const client = scoreClient({
      totalOutstanding: outstanding,
      overdue60PlusAmount: overdue,
      promises,
      topDebtorOutstanding: topDebtor,
      // No per-debtor data on the list page — scorer redistributes weights.
    });
    const gradeTooltip = client.numeric === null
      ? "Not enough data to grade yet"
      : [
          `Grade: ${client.grade} (${client.numeric}/100)`,
          `Promise keep-rate: ${(client.factors.promiseKeepRate * 100).toFixed(0)}%`,
          `60+ overdue: ${(client.factors.overdueConcentration * 100).toFixed(0)}%`,
          `Top debtor share: ${(client.factors.topDebtorShare * 100).toFixed(0)}%`,
        ].join(" · ");
    return {
      id: c.id,
      name: c.displayName,
      status: c.status,
      outstanding,
      overdue,
      debtorCount: c._count.parties,
      lastSynced: formatDistanceToNow(c.updatedAt, { addSuffix: true }),
      outstandingFormatted: formatINR(outstanding),
      overdueFormatted: overdue > 0 ? formatINR(overdue) : null,
      sparkline: sparkByClient.get(c.id) ?? [],
      grade: client.grade as Grade | null,
      gradeTooltip,
    };
  });

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
