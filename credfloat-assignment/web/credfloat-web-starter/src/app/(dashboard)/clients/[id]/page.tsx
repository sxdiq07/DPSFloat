import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { formatINR } from "@/lib/currency";
import { AGE_BUCKET_COLORS, AGE_BUCKET_LABELS } from "@/lib/ageing";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { ChevronLeft, Mail, Phone, MessageCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const firmId = await requireFirmId();
  const { id } = await params;

  const client = await prisma.clientCompany.findFirst({
    where: { id, firmId },
    include: {
      parties: {
        orderBy: { closingBalance: "desc" },
      },
      invoices: {
        where: { status: "OPEN" },
        include: { party: true },
        orderBy: [{ ageBucket: "desc" }, { dueDate: "asc" }],
      },
    },
  });

  if (!client) notFound();

  const totalOutstanding = client.invoices.reduce(
    (sum, i) => sum + Number(i.outstandingAmount),
    0,
  );
  const partiesWithBalance = client.parties.filter(
    (p) => Number(p.closingBalance) > 0,
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to clients
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {client.displayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Tally: {client.tallyCompanyName}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MiniKpi label="Total outstanding" value={formatINR(totalOutstanding)} />
        <MiniKpi label="Open invoices" value={`${client.invoices.length}`} />
        <MiniKpi label="Debtors" value={`${partiesWithBalance.length}`} />
      </div>

      {/* Debtors */}
      <section className="rounded-lg border bg-card">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Debtors</h2>
        </div>
        {partiesWithBalance.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            No debtors with outstanding balance.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Name</th>
                <th className="px-6 py-3 text-left font-medium">Contact</th>
                <th className="px-6 py-3 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {partiesWithBalance.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-6 py-3 font-medium">
                    {p.mailingName || p.tallyLedgerName}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {p.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {p.email}
                        </span>
                      )}
                      {p.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {p.phone}
                        </span>
                      )}
                      {p.whatsappNumber && (
                        <span className="inline-flex items-center gap-1">
                          <MessageCircle className="h-3 w-3" />
                          WhatsApp
                        </span>
                      )}
                      {!p.email && !p.phone && !p.whatsappNumber && (
                        <span className="text-amber-700">No contact info</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">
                    {formatINR(Number(p.closingBalance))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Invoices */}
      <section className="rounded-lg border bg-card">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Open invoices</h2>
        </div>
        {client.invoices.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            No open invoices. Sync bill-wise data via the connector.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Bill ref</th>
                <th className="px-6 py-3 text-left font-medium">Debtor</th>
                <th className="px-6 py-3 text-left font-medium">Bill date</th>
                <th className="px-6 py-3 text-left font-medium">Due date</th>
                <th className="px-6 py-3 text-right font-medium">Amount</th>
                <th className="px-6 py-3 text-left font-medium">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {client.invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-muted/30">
                  <td className="px-6 py-3 font-medium">{inv.billRef}</td>
                  <td className="px-6 py-3 text-muted-foreground">
                    {inv.party.mailingName || inv.party.tallyLedgerName}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">
                    {formatInTimeZone(inv.billDate, "Asia/Kolkata", "dd MMM yyyy")}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">
                    {inv.dueDate
                      ? formatInTimeZone(inv.dueDate, "Asia/Kolkata", "dd MMM yyyy")
                      : "—"}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">
                    {formatINR(Number(inv.outstandingAmount))}
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={`inline-block rounded border px-2 py-0.5 text-xs ${AGE_BUCKET_COLORS[inv.ageBucket]}`}
                    >
                      {AGE_BUCKET_LABELS[inv.ageBucket]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
