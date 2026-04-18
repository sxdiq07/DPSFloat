import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { formatINR } from "@/lib/currency";
import { AGE_BUCKET_LABELS } from "@/lib/ageing";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { Mail, Phone, MessageCircle, MapPin } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

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
      parties: { orderBy: { closingBalance: "desc" } },
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
  const reachable = partiesWithBalance.filter(
    (p) => p.email || p.phone || p.whatsappNumber,
  ).length;

  return (
    <div className="space-y-10">
      <PageHeader
        crumbs={[
          { label: "Clients", href: "/clients" },
          { label: client.displayName },
        ]}
        eyebrow="Client company"
        title={client.displayName}
        subtitle={
          <>
            Tally ledger name ·{" "}
            <span className="tabular">{client.tallyCompanyName}</span>
          </>
        }
      />

      {/* KPI tiles */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MiniKpi
          label="Total outstanding"
          value={formatINR(totalOutstanding)}
          tone="neutral"
        />
        <MiniKpi
          label="Open invoices"
          value={`${client.invoices.length}`}
          tone="neutral"
        />
        <MiniKpi
          label="Debtors with balance"
          value={`${partiesWithBalance.length}`}
          sub={`${reachable} digitally reachable`}
          tone="neutral"
        />
      </section>

      {/* Debtors */}
      <section className="card-apple overflow-hidden">
        <div className="flex items-end justify-between px-8 pt-7 pb-5">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-ink">
              Debtors
            </h2>
            <p className="mt-1 text-[14px] text-ink-3">
              {partiesWithBalance.length} with outstanding balance, sorted by
              amount.
            </p>
          </div>
        </div>
        {partiesWithBalance.length === 0 ? (
          <div className="border-t border-subtle px-8 py-16 text-center">
            <p className="text-[15px] text-ink-2">No outstanding debtors.</p>
          </div>
        ) : (
          <div className="border-t border-subtle">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                  <th className="px-8 py-3 text-left font-medium">Name</th>
                  <th className="px-8 py-3 text-left font-medium">
                    Reachable via
                  </th>
                  <th className="px-8 py-3 text-right font-medium">
                    Outstanding
                  </th>
                </tr>
              </thead>
              <tbody>
                {partiesWithBalance.map((p, i) => (
                  <tr
                    key={p.id}
                    className={`row-interactive ${i > 0 ? "border-t border-subtle" : "border-t border-subtle"}`}
                  >
                    <td className="px-8 py-4 font-medium text-ink">
                      {p.mailingName || p.tallyLedgerName}
                    </td>
                    <td className="px-8 py-4">
                      <ContactIcons
                        email={p.email}
                        phone={p.phone}
                        whatsapp={p.whatsappNumber}
                        address={p.address}
                      />
                    </td>
                    <td className="tabular px-8 py-4 text-right font-medium text-ink">
                      {formatINR(Number(p.closingBalance))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Invoices */}
      <section className="card-apple overflow-hidden">
        <div className="px-8 pt-7 pb-5">
          <h2 className="text-[22px] font-semibold tracking-tight text-ink">
            Open invoices
          </h2>
          <p className="mt-1 text-[14px] text-ink-3">
            Ageing is recomputed daily by the cron job.
          </p>
        </div>
        {client.invoices.length === 0 ? (
          <div className="border-t border-subtle px-8 py-16 text-center">
            <p className="text-[15px] text-ink-2">No open invoices.</p>
            <p className="mt-1 text-[13px] text-ink-3">
              Bill-wise sync requires Tally XML HTTP (Phase 2 work).
            </p>
          </div>
        ) : (
          <div className="border-t border-subtle">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                  <th className="px-8 py-3 text-left font-medium">Bill ref</th>
                  <th className="px-8 py-3 text-left font-medium">Debtor</th>
                  <th className="px-8 py-3 text-left font-medium">Bill date</th>
                  <th className="px-8 py-3 text-left font-medium">Due date</th>
                  <th className="px-8 py-3 text-right font-medium">Amount</th>
                  <th className="px-8 py-3 text-left font-medium">Age</th>
                </tr>
              </thead>
              <tbody>
                {client.invoices.map((inv, i) => (
                  <tr
                    key={inv.id}
                    className={`row-interactive ${i > 0 ? "border-t border-subtle" : "border-t border-subtle"}`}
                  >
                    <td className="px-8 py-4 font-medium text-ink">
                      {inv.billRef}
                    </td>
                    <td className="px-8 py-4 text-ink-2">
                      {inv.party.mailingName || inv.party.tallyLedgerName}
                    </td>
                    <td className="tabular px-8 py-4 text-ink-3">
                      {formatInTimeZone(
                        inv.billDate,
                        "Asia/Kolkata",
                        "dd MMM yyyy",
                      )}
                    </td>
                    <td className="tabular px-8 py-4 text-ink-3">
                      {inv.dueDate
                        ? formatInTimeZone(
                            inv.dueDate,
                            "Asia/Kolkata",
                            "dd MMM yyyy",
                          )
                        : "—"}
                    </td>
                    <td className="tabular px-8 py-4 text-right font-medium text-ink">
                      {formatINR(Number(inv.outstandingAmount))}
                    </td>
                    <td className="px-8 py-4">
                      <AgePill bucket={inv.ageBucket} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MiniKpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "neutral";
}) {
  return (
    <div className="card-apple p-6">
      <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {label}
      </div>
      <div className="tabular mt-3 text-[26px] font-semibold leading-none tracking-tight text-ink">
        {value}
      </div>
      {sub && <div className="mt-2 text-[12px] text-ink-3">{sub}</div>}
    </div>
  );
}

function ContactIcons({
  email,
  phone,
  whatsapp,
  address,
}: {
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
}) {
  const hasAny = email || phone || whatsapp;
  if (!hasAny && !address) {
    return (
      <span
        className="pill"
        style={{
          background: "hsl(44 100% 93%)",
          color: "hsl(32 80% 30%)",
        }}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "hsl(32 100% 52%)" }}
        />
        Missing contact
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2 text-ink-3">
      {email && (
        <span title={email} className="inline-flex items-center gap-1">
          <Mail className="h-3.5 w-3.5" />
        </span>
      )}
      {whatsapp && (
        <span title={whatsapp} className="inline-flex items-center gap-1">
          <MessageCircle className="h-3.5 w-3.5" />
        </span>
      )}
      {phone && (
        <span title={phone} className="inline-flex items-center gap-1">
          <Phone className="h-3.5 w-3.5" />
        </span>
      )}
      {!email && !phone && !whatsapp && address && (
        <span
          className="pill"
          style={{
            background: "hsl(240 9% 94%)",
            color: "hsl(240 3% 36%)",
          }}
        >
          <MapPin className="h-3 w-3" />
          Address only
        </span>
      )}
    </div>
  );
}

function AgePill({ bucket }: { bucket: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    CURRENT: { bg: "hsl(142 60% 94%)", color: "hsl(142 64% 24%)" },
    DAYS_0_30: { bg: "hsl(211 100% 95%)", color: "hsl(211 86% 32%)" },
    DAYS_30_60: { bg: "hsl(44 100% 93%)", color: "hsl(32 80% 30%)" },
    DAYS_60_90: { bg: "hsl(22 100% 93%)", color: "hsl(14 86% 32%)" },
    DAYS_90_PLUS: { bg: "hsl(4 100% 95%)", color: "hsl(4 72% 38%)" },
  };
  const s = styles[bucket] ?? styles.CURRENT;
  return (
    <span className="pill" style={{ background: s.bg, color: s.color }}>
      {AGE_BUCKET_LABELS[bucket as keyof typeof AGE_BUCKET_LABELS] ?? bucket}
    </span>
  );
}
