import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { formatINR } from "@/lib/currency";
import { buildLedgerStatement } from "@/lib/ledger-data";
import type { LedgerPeriod } from "@/lib/ledger-token";
import { signLedgerToken } from "@/lib/ledger-token";
import { FileDown, ArrowLeftRight } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";

const PERIOD_OPTIONS = [
  { value: "FY_TO_DATE", label: "FY to date" },
  { value: "LAST_12_MONTHS", label: "Last 12 months" },
  { value: "OPEN_ITEMS_ONLY", label: "Open items only" },
  { value: "ALL_HISTORY", label: "All history" },
] as const;

type PeriodQuery =
  | "FY_TO_DATE"
  | "LAST_12_MONTHS"
  | "OPEN_ITEMS_ONLY"
  | "ALL_HISTORY"
  | "CUSTOM";

function toPeriod(
  q: PeriodQuery | undefined,
  start?: string,
  end?: string,
): LedgerPeriod {
  if (q === "CUSTOM" && start && end) {
    return { type: "CUSTOM", start, end };
  }
  if (q === "LAST_12_MONTHS") return { type: "LAST_12_MONTHS" };
  if (q === "OPEN_ITEMS_ONLY") return { type: "OPEN_ITEMS_ONLY" };
  if (q === "ALL_HISTORY") return { type: "ALL_HISTORY" };
  return { type: "FY_TO_DATE" };
}

export default async function DebtorLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; partyId: string }>;
  searchParams: Promise<{ p?: PeriodQuery; from?: string; to?: string }>;
}) {
  const firmId = await requireFirmId();
  const { id, partyId } = await params;
  const sp = await searchParams;

  const client = await prisma.clientCompany.findFirst({
    where: { id, firmId },
    select: { id: true, displayName: true },
  });
  if (!client) notFound();

  const party = await prisma.party.findFirst({
    where: {
      id: partyId,
      clientCompany: { id: client.id },
      deletedAt: null,
    },
    select: { id: true, tallyLedgerName: true, mailingName: true },
  });
  if (!party) notFound();

  const period = toPeriod(sp.p, sp.from, sp.to);
  const statement = await buildLedgerStatement(partyId, period);
  if (!statement) notFound();

  // Signed URL for the "Download PDF" shortcut.
  const token = signLedgerToken({ partyId, period });
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const pdfUrl = `${base}/api/ledger/${token}`;

  const currentP = sp.p ?? "FY_TO_DATE";
  const href = (value: string) =>
    `/clients/${id}/ledger/${partyId}?p=${value}`;

  return (
    <div className="space-y-8">
      <PageHeader
        crumbs={[
          { label: "Clients", href: "/clients" },
          { label: client.displayName, href: `/clients/${client.id}` },
          { label: "Ledger" },
        ]}
        eyebrow="Drill-down"
        title={party.mailingName || party.tallyLedgerName}
        subtitle={
          <>
            Ledger statement in the books of{" "}
            <span className="font-medium text-ink-2">
              {client.displayName}
            </span>{" "}
            · {statement.period.label}
          </>
        }
        action={
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-4 py-2 text-[13.5px] font-medium text-ink-2 transition-all hover:border-[var(--color-border-hair)] hover:text-ink"
          >
            <FileDown className="h-3.5 w-3.5" />
            Download PDF
          </a>
        }
      />

      {/* Period chips */}
      <section className="card-apple p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Period
          </span>
          {PERIOD_OPTIONS.map((opt) => {
            const active = currentP === opt.value;
            return (
              <Link
                key={opt.value}
                href={href(opt.value)}
                className={`rounded-full border px-3 py-1 text-[12.5px] transition-all ${
                  active
                    ? "border-[var(--color-accent-blue)] bg-[rgba(0,113,227,0.06)] text-ink"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] text-ink-2 hover:border-[var(--color-border-hair)] hover:text-ink"
                }`}
              >
                {opt.label}
              </Link>
            );
          })}
        </div>
      </section>

      {/* Summary strip */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <SummaryCard
          label="Opening balance"
          value={formatINR(statement.openingBalance)}
        />
        <SummaryCard
          label="Total debit"
          value={formatINR(statement.totals.debit)}
          tone="neutral"
        />
        <SummaryCard
          label="Total credit"
          value={formatINR(statement.totals.credit)}
          tone="neutral"
        />
        <SummaryCard
          label="Closing balance"
          value={formatINR(statement.closingBalance)}
          tone="accent"
        />
      </section>

      {/* Ledger table */}
      <section className="card-apple overflow-hidden">
        {statement.rows.length === 0 ? (
          <div className="px-8 py-16 text-center">
            <p className="text-[15px] font-medium text-ink">
              No transactions in this period
            </p>
            <p className="mt-1 text-[13px] text-ink-3">
              Opening and closing balance both sit at{" "}
              {formatINR(statement.closingBalance)}.
            </p>
          </div>
        ) : (
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-subtle text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                <th className="px-6 py-3 text-left font-medium">Date</th>
                <th className="px-6 py-3 text-left font-medium">Type</th>
                <th className="px-6 py-3 text-left font-medium">Voucher</th>
                <th className="px-6 py-3 text-left font-medium">Particulars</th>
                <th className="px-6 py-3 text-right font-medium">Debit</th>
                <th className="px-6 py-3 text-right font-medium">Credit</th>
                <th className="px-6 py-3 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-subtle bg-[var(--color-surface-2)]/40">
                <td className="px-6 py-3 text-ink-3">—</td>
                <td className="px-6 py-3 text-ink-3">—</td>
                <td className="px-6 py-3 text-ink-3">—</td>
                <td className="px-6 py-3 font-medium text-ink-2">
                  Opening balance
                </td>
                <td className="px-6 py-3 text-right text-ink-3">—</td>
                <td className="px-6 py-3 text-right text-ink-3">—</td>
                <td className="tabular px-6 py-3 text-right font-medium text-ink">
                  {formatINR(statement.openingBalance)}
                </td>
              </tr>
              {statement.rows.map((r, i) => (
                <tr
                  key={i}
                  className={`row-interactive ${i === statement.rows.length - 1 ? "" : "border-b border-subtle"}`}
                >
                  <td className="tabular px-6 py-3 text-ink-3">
                    {formatInTimeZone(r.date, "Asia/Kolkata", "dd MMM yyyy")}
                  </td>
                  <td className="px-6 py-3 text-ink-3">
                    {r.voucherType}
                  </td>
                  <td className="px-6 py-3 font-medium text-ink-2">
                    {r.voucher}
                  </td>
                  <td className="px-6 py-3 text-ink-2">{r.particulars}</td>
                  <td className="tabular px-6 py-3 text-right text-ink">
                    {r.debit > 0 ? formatINR(r.debit) : ""}
                  </td>
                  <td className="tabular px-6 py-3 text-right text-ink">
                    {r.credit > 0 ? formatINR(r.credit) : ""}
                  </td>
                  <td className="tabular px-6 py-3 text-right font-medium text-ink">
                    {formatINR(r.runningBalance)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--color-border-hair)] bg-[var(--color-surface-2)]/40">
                <td className="px-6 py-3"></td>
                <td className="px-6 py-3"></td>
                <td className="px-6 py-3"></td>
                <td className="px-6 py-3 font-semibold text-ink">
                  Totals · closing balance
                </td>
                <td className="tabular px-6 py-3 text-right font-semibold text-ink">
                  {formatINR(statement.totals.debit)}
                </td>
                <td className="tabular px-6 py-3 text-right font-semibold text-ink">
                  {formatINR(statement.totals.credit)}
                </td>
                <td className="tabular px-6 py-3 text-right font-semibold text-ink">
                  {formatINR(statement.closingBalance)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <p className="flex items-center gap-2 text-[12px] text-ink-3">
        <ArrowLeftRight className="h-3 w-3" />
        Debit rows = invoices raised. Credit rows = receipts & credit notes
        allocated to this debtor. Running balance is positive when the
        debtor owes.
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "accent";
}) {
  return (
    <div className="card-apple p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {label}
      </p>
      <p
        className={`tabular mt-2 text-[20px] font-semibold leading-none tracking-tight ${
          tone === "accent" ? "text-[var(--color-accent-blue)]" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
