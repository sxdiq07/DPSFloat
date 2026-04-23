import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { formatINR } from "@/lib/currency";
import { AGE_BUCKET_LABELS } from "@/lib/ageing";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { Mail, Phone, MessageCircle, MapPin, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/ui/stat-card";
import { ExportDebtorsButton } from "./_components/export-debtors-button";
import { ArchiveDebtorButton } from "./_components/archive-debtor-button";
import { IvrCallButton } from "./_components/ivr-call-button";
import { NotesTimeline, type TimelineEvent } from "./_components/notes-timeline";
import { PromisesPanel, type PromiseRow } from "./_components/promises-panel";
import { scoreDebtor } from "@/lib/scoring";
import { GradePill } from "@/components/ui/grade-pill";
import { computeAgeBucket, daysOverdue } from "@/lib/ageing";
import {
  PortalLinkPanel,
  type PortalTokenRow,
} from "./_components/portal-link-panel";
import { SendReminderButton } from "./_components/send-reminder-button";
import { DownloadLedgerButton } from "./_components/download-ledger-button";
import { InvoiceActions } from "./_components/invoice-actions";
import { ExportRemindersButton } from "./_components/export-reminders-button";
import { BookOpen } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
        where: { deletedAt: null },
        // Sorted in JS below by actual *due* (post-FIFO invoice) outstanding,
        // not gross closingBalance — the ledger balance can include advances,
        // credit notes, and journal adjustments unrelated to open bills.
        include: {
          promises: { select: { status: true } },
        },
      },
      invoices: {
        where: {
          status: "OPEN",
          deletedAt: null,
          party: { deletedAt: null },
        },
        include: { party: true },
        orderBy: [{ ageBucket: "desc" }, { dueDate: "asc" }],
      },
      notes: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { author: { select: { id: true, name: true } } },
      },
    },
  });

  if (!client) notFound();

  // ReminderSent reached via Invoice (no direct relation on ClientCompany)
  const remindersSent = await prisma.reminderSent.findMany({
    where: { invoice: { clientCompanyId: client.id } },
    include: { party: true, invoice: true },
    orderBy: { sentAt: "desc" },
    take: 100,
  });

  // Disputed invoice party-ids — used by the debtor-grade calculator
  // to knock a grade on parties with any active dispute. Fetched as a
  // tiny distinct-party list so we don't widen the main invoices pull.
  const disputedParties = new Set<string>(
    (
      await prisma.invoice.findMany({
        where: {
          clientCompanyId: client.id,
          status: "DISPUTED",
          deletedAt: null,
        },
        select: { partyId: true },
      })
    ).map((r) => r.partyId),
  );

  const session = await (await import("@/lib/auth")).auth();
  const currentUserId = session?.user?.id ?? null;

  // Active portal token (at most one per client by convention)
  const activeToken = await prisma.portalToken.findFirst({
    where: {
      clientCompanyId: client.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
  });
  const base =
    process.env.NEXTAUTH_URL ??
    (typeof window === "undefined" ? "http://localhost:3000" : "");
  const activePortal: PortalTokenRow | null = activeToken
    ? {
        id: activeToken.id,
        token: activeToken.token,
        url: `${base}/portal/${activeToken.token}`,
        createdAt: activeToken.createdAt.toISOString(),
        expiresAt: activeToken.expiresAt?.toISOString() ?? null,
        lastUsedAt: activeToken.lastUsedAt?.toISOString() ?? null,
      }
    : null;

  // Promises across all debtors of this client
  const allPromises = await prisma.promiseToPay.findMany({
    where: { party: { clientCompanyId: client.id } },
    orderBy: [{ status: "asc" }, { promisedBy: "asc" }],
    include: {
      party: { select: { tallyLedgerName: true, mailingName: true } },
      recorder: { select: { name: true } },
    },
  });

  // Ledger balance is the truth — Tally has already netted every sale,
  // receipt, credit note, and journal adjustment on the debtor ledger.
  // The actual "due" from a debtor is therefore max(0, closingBalance).
  // Invoice-level outstandings (post-FIFO) remain the per-bill breakdown
  // for reminder targeting and ageing, but they can diverge from the
  // ledger when receipts landed on ledgers we didn't sync (e.g. bank
  // adjustments, non-debtor sub-groups) — in that case trust the ledger.
  const partyLedgerDue = (closingBalance: unknown) =>
    Math.max(0, Number(closingBalance));

  // Invoice-level due per party — used as a secondary drill-down figure
  // and to flag when FIFO's sum-of-bills disagrees with the ledger.
  const invoiceOutstandingByParty = new Map<string, number>();
  for (const inv of client.invoices) {
    invoiceOutstandingByParty.set(
      inv.partyId,
      (invoiceOutstandingByParty.get(inv.partyId) ?? 0) +
        Number(inv.outstandingAmount),
    );
  }
  const partyInvoiceDue = (partyId: string) =>
    invoiceOutstandingByParty.get(partyId) ?? 0;

  // Total outstanding for this client = sum of positive debtor ledger
  // balances (not sum of open invoice amounts).
  const totalOutstanding = client.parties.reduce(
    (sum, p) => sum + partyLedgerDue(p.closingBalance),
    0,
  );

  const partiesWithBalance = client.parties
    .filter((p) => partyLedgerDue(p.closingBalance) > 0)
    .sort(
      (a, b) =>
        partyLedgerDue(b.closingBalance) - partyLedgerDue(a.closingBalance),
    );
  const reachable = partiesWithBalance.filter(
    (p) => p.email || p.phone || p.whatsappNumber,
  ).length;
  const reachablePct =
    partiesWithBalance.length === 0
      ? 0
      : Math.round((reachable / partiesWithBalance.length) * 100);

  const withEmail = partiesWithBalance.filter((p) => p.email).length;
  const withWhatsApp = partiesWithBalance.filter((p) => p.whatsappNumber).length;
  const withPhone = partiesWithBalance.filter((p) => p.phone).length;

  // Timeline events = notes + recent reminders merged + promises
  const timeline: TimelineEvent[] = [];
  for (const n of client.notes) {
    timeline.push({
      key: `n-${n.id}`,
      kind: "note",
      at: n.createdAt.toISOString(),
      title: <span className="font-medium">{n.author.name} left a note</span>,
      body: n.body,
      authorName: n.author.name,
      noteId: n.id,
      canDelete: n.author.id === currentUserId || session?.user?.role === "PARTNER",
    });
  }
  for (const r of remindersSent.slice(0, 30)) {
    timeline.push({
      key: `r-${r.id}`,
      kind: "reminder",
      at: r.sentAt.toISOString(),
      title: (
        <span>
          <span className="font-medium">
            {r.channel.charAt(0) + r.channel.slice(1).toLowerCase()}
          </span>{" "}
          reminder sent to{" "}
          <span className="font-medium">
            {r.party.mailingName || r.party.tallyLedgerName}
          </span>{" "}
          for <span className="tabular">{r.invoice.billRef}</span>
        </span>
      ),
      body:
        r.status === "FAILED" ? `Failed: ${r.error ?? "unknown error"}` : undefined,
      reminderId: r.id,
      canDelete: session?.user?.role === "PARTNER",
    });
  }
  for (const p of allPromises) {
    timeline.push({
      key: `p-${p.id}`,
      kind: "promise",
      at: p.recordedAt.toISOString(),
      title: (
        <span>
          <span className="font-medium">{p.recorder.name}</span> recorded a
          promise from{" "}
          <span className="font-medium">
            {p.party.mailingName || p.party.tallyLedgerName}
          </span>
        </span>
      ),
      body: `${formatINR(Number(p.amount))} by ${formatInTimeZone(p.promisedBy, "Asia/Kolkata", "dd MMM yyyy")}${p.notes ? ` — "${p.notes}"` : ""}`,
    });
  }
  timeline.sort((a, b) => (a.at < b.at ? 1 : -1));

  const promiseRows: PromiseRow[] = allPromises.map((p) => ({
    id: p.id,
    partyName: p.party.mailingName || p.party.tallyLedgerName,
    amount: Number(p.amount),
    promisedBy: p.promisedBy.toISOString(),
    status: p.status,
    notes: p.notes,
    recordedAt: p.recordedAt.toISOString(),
    recorderName: p.recorder.name,
    amountFormatted: formatINR(Number(p.amount)),
  }));

  const partiesForForm = partiesWithBalance.map((p) => ({
    id: p.id,
    name: p.mailingName || p.tallyLedgerName,
  }));

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
        action={
          <Link
            href={`/clients/${client.id}/reminders`}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-4 py-2 text-[14px] font-medium text-ink-2 transition-all hover:border-[var(--color-border-hair)] hover:text-ink"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Reminder settings
          </Link>
        }
      />

      {/* KPI tiles */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <StatCard
          label="Total outstanding"
          value={totalOutstanding}
          tone="neutral"
          prefix="₹"
          sub={`${client.invoices.length} open invoice${client.invoices.length === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Debtors with balance"
          value={partiesWithBalance.length}
          tone="neutral"
          sub={`${client.parties.length} total ledgers synced`}
        />
        <StatCard
          label="Digitally reachable"
          value={reachable}
          tone={reachablePct >= 50 ? "success" : reachablePct >= 20 ? "accent" : "danger"}
          suffix={` / ${partiesWithBalance.length}`}
          sub={`${reachablePct}% have email, WhatsApp or phone on file`}
        />
      </section>

      {/* Contact coverage insight */}
      {partiesWithBalance.length > 0 && (
        <section className="card-apple p-8">
          <div className="flex items-end justify-between gap-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                Contact coverage
              </p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
                Reachability by channel
              </h2>
              <p className="mt-1 text-[14px] text-ink-3">
                Counts of debtors with each contact channel populated from Tally.
              </p>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ChannelBar
              label="Email"
              icon={<Mail className="h-3.5 w-3.5" />}
              count={withEmail}
              total={partiesWithBalance.length}
              gradient="linear-gradient(90deg, #0a84ff, #5e5ce6)"
            />
            <ChannelBar
              label="WhatsApp"
              icon={<MessageCircle className="h-3.5 w-3.5" />}
              count={withWhatsApp}
              total={partiesWithBalance.length}
              gradient="linear-gradient(90deg, #30d158, #34c7b8)"
            />
            <ChannelBar
              label="Phone"
              icon={<Phone className="h-3.5 w-3.5" />}
              count={withPhone}
              total={partiesWithBalance.length}
              gradient="linear-gradient(90deg, #ff9f0a, #ff6b3d)"
            />
          </div>
        </section>
      )}

      {/* Tabs: Debtors / Invoices / Reminders */}
      {/* Client portal link */}
      <PortalLinkPanel
        clientId={client.id}
        clientName={client.displayName}
        active={activePortal}
      />

      {/* Promises */}
      <PromisesPanel parties={partiesForForm} promises={promiseRows} />

      {/* Activity timeline (notes + reminders + promises) */}
      <NotesTimeline clientCompanyId={client.id} events={timeline} />

      <Tabs defaultValue="debtors" className="flex flex-col gap-5">
        <TabsList className="self-start bg-[var(--color-surface-2)]">
          <TabsTrigger value="debtors">
            Debtors
            <span className="ml-2 text-[11px] text-ink-3">
              {partiesWithBalance.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="invoices">
            Invoices
            <span className="ml-2 text-[11px] text-ink-3">
              {client.invoices.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="reminders">
            Reminder log
            <span className="ml-2 text-[11px] text-ink-3">
              {remindersSent.length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="debtors" className="m-0">
          <div className="card-apple overflow-hidden">
            {partiesWithBalance.length > 0 && (
              <div className="flex items-center justify-between border-b border-subtle px-8 py-4">
                <div className="text-[12.5px] text-ink-3">
                  {partiesWithBalance.length} debtor
                  {partiesWithBalance.length === 1 ? "" : "s"} with outstanding
                  balance, sorted by amount.
                </div>
                <ExportDebtorsButton
                  clientName={client.displayName}
                  rows={partiesWithBalance.map((p) => ({
                    name: p.mailingName || p.tallyLedgerName,
                    email: p.email,
                    phone: p.phone,
                    whatsapp: p.whatsappNumber,
                    address: p.address,
                    outstanding: partyLedgerDue(p.closingBalance),
                  }))}
                />
              </div>
            )}
            {partiesWithBalance.length === 0 ? (
              <EmptyRow
                title="No outstanding debtors"
                body="Every synced ledger has a zero or credit balance."
              />
            ) : (
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                    <th className="px-8 py-4 text-left font-medium">Name</th>
                    <th className="px-8 py-4 text-left font-medium">
                      Reachable via
                    </th>
                    <th className="px-8 py-4 text-left font-medium">
                      Reliability
                    </th>
                    <th className="px-8 py-4 text-right font-medium">
                      Outstanding
                    </th>
                    <th className="px-8 py-4 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {partiesWithBalance.map((p, i) => {
                    const kept = p.promises.filter(
                      (pr) => pr.status === "KEPT",
                    ).length;
                    const broken = p.promises.filter(
                      (pr) => pr.status === "BROKEN",
                    ).length;
                    const openPastDue = 0;
                    const partyInvoices = client.invoices.filter(
                      (inv) => inv.partyId === p.id,
                    );
                    const maxOverdue = partyInvoices.reduce((m, inv) => {
                      if (!inv.dueDate) return m;
                      const d = daysOverdue(inv.dueDate);
                      return Math.max(m, Math.max(0, d));
                    }, 0);
                    // Per-party ageing breakdown for the scorer
                    const ageing = {
                      current: 0,
                      days_0_30: 0,
                      days_30_60: 0,
                      days_60_90: 0,
                      days_90_plus: 0,
                    };
                    for (const inv of partyInvoices) {
                      const amt = Number(inv.outstandingAmount);
                      switch (inv.ageBucket) {
                        case "CURRENT":
                          ageing.current += amt;
                          break;
                        case "DAYS_0_30":
                          ageing.days_0_30 += amt;
                          break;
                        case "DAYS_30_60":
                          ageing.days_30_60 += amt;
                          break;
                        case "DAYS_60_90":
                          ageing.days_60_90 += amt;
                          break;
                        case "DAYS_90_PLUS":
                          ageing.days_90_plus += amt;
                          break;
                      }
                    }
                    const hasOpenDispute = disputedParties.has(p.id);
                    // Reminder engagement stats from the 100-row slice
                    const partyReminders = remindersSent.filter(
                      (r) => r.partyId === p.id,
                    );
                    const reminderStats =
                      partyReminders.length > 0
                        ? {
                            sent: partyReminders.length,
                            delivered: partyReminders.filter(
                              (r) =>
                                r.status === "DELIVERED" ||
                                r.status === "READ" ||
                                r.status === "SENT",
                            ).length,
                            opened: partyReminders.filter(
                              (r) => r.status === "READ",
                            ).length,
                            bounced: partyReminders.filter(
                              (r) =>
                                r.status === "BOUNCED" || r.status === "FAILED",
                            ).length,
                          }
                        : undefined;
                    const debtorScore = scoreDebtor({
                      kept,
                      broken,
                      openPastDue,
                      daysOverdueMax: maxOverdue,
                      ageing,
                      reminderStats,
                      hasOpenDispute,
                      optedOut: p.optedOut,
                      archived: false,
                    });
                    const scoreTooltip = debtorScore.numeric === null
                      ? "Not enough data to grade yet"
                      : [
                          `Grade: ${debtorScore.grade} (${debtorScore.numeric}/100)`,
                          `Promise keep-rate: ${(debtorScore.factors.keepRate * 100).toFixed(0)}%`,
                          `60+ overdue share: ${(debtorScore.factors.agingConcentration * 100).toFixed(0)}%`,
                          debtorScore.factors.responseRate !== null
                            ? `Reminder response: ${(debtorScore.factors.responseRate * 100).toFixed(0)}%`
                            : `Reminder response: insufficient data`,
                          hasOpenDispute ? `Open dispute: yes (−1 grade)` : null,
                        ]
                          .filter(Boolean)
                          .join("\n");
                    return (
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
                        <td className="px-8 py-4">
                          <GradePill
                            grade={debtorScore.grade}
                            tooltip={scoreTooltip}
                          />
                        </td>
                        <td className="tabular px-8 py-4 text-right font-medium text-ink">
                          <div className="flex flex-col items-end">
                            <span>
                              {formatINR(partyLedgerDue(p.closingBalance))}
                            </span>
                            {Number(p.advanceAmount) > 0 && (
                              <span className="mt-0.5 text-[10.5px] font-medium text-emerald-700">
                                advance {formatINR(Number(p.advanceAmount))}
                              </span>
                            )}
                            {(() => {
                              const billsDue = partyInvoiceDue(p.id);
                              const ledgerDue = partyLedgerDue(p.closingBalance);
                              const gap = Math.abs(billsDue - ledgerDue);
                              // Exact match → show nothing extra; ledger is truth.
                              if (gap <= 1) return null;
                              // Ledger owes money but no bill-wise data synced
                              // for this debtor (Tally ledger likely doesn't have
                              // "Maintain balances bill-by-bill" enabled). Say so
                              // explicitly instead of showing a misleading ₹0.
                              if (billsDue <= 1 && ledgerDue > 1) {
                                return (
                                  <span
                                    className="mt-0.5 text-[10.5px] text-ink-3"
                                    title="Tally's bill-wise tracking isn't enabled for this debtor. Enable 'Maintain balances bill-by-bill' on their ledger to chase specific bills."
                                  >
                                    No bill-wise data
                                  </span>
                                );
                              }
                              return (
                                <span
                                  className="mt-0.5 text-[10.5px] text-ink-3"
                                  title="Sum of open bill residuals post-FIFO — differs from ledger when Tally has adjustments we didn't sync."
                                >
                                  bills {formatINR(billsDue)}
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-8 py-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Link
                              href={`/clients/${client.id}/ledger/${p.id}`}
                              title="Open ledger drill-down"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] text-ink-3 transition-all hover:border-[var(--color-border-hair)] hover:text-ink"
                            >
                              <BookOpen className="h-3 w-3" />
                            </Link>
                            <DownloadLedgerButton partyId={p.id} />
                            <IvrCallButton
                              partyId={p.id}
                              partyName={p.mailingName || p.tallyLedgerName}
                            />
                            <ArchiveDebtorButton
                              partyId={p.id}
                              partyName={p.mailingName || p.tallyLedgerName}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="invoices" className="m-0">
          <div className="card-apple overflow-hidden">
            {client.invoices.length === 0 ? (
              <EmptyRow
                title="No open invoices yet"
                body="Bill-wise invoice sync requires Tally XML HTTP (Phase 2)."
              />
            ) : (
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                    <th className="px-8 py-4 text-left font-medium">Bill ref</th>
                    <th className="px-8 py-4 text-left font-medium">Debtor</th>
                    <th className="px-8 py-4 text-left font-medium">Bill date</th>
                    <th className="px-8 py-4 text-left font-medium">Due date</th>
                    <th className="px-8 py-4 text-right font-medium">Amount</th>
                    <th className="px-8 py-4 text-left font-medium">Age</th>
                    <th className="px-8 py-4 text-right font-medium"></th>
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
                        <div className="flex flex-col items-end">
                          <span>{formatINR(Number(inv.outstandingAmount))}</span>
                          {Number(inv.outstandingAmount) <
                            Number(inv.originalAmount) && (
                            <span className="mt-0.5 text-[10.5px] text-ink-3">
                              paid{" "}
                              {formatINR(
                                Number(inv.originalAmount) -
                                  Number(inv.outstandingAmount),
                              )}{" "}
                              of {formatINR(Number(inv.originalAmount))}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-4">
                        <AgePill bucket={inv.ageBucket} />
                      </td>
                      <td className="px-8 py-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <InvoiceActions
                            invoiceId={inv.id}
                            currentStatus={inv.status}
                          />
                          <SendReminderButton
                            invoiceId={inv.id}
                            hasEmail={Boolean(inv.party.email)}
                            hasWhatsApp={Boolean(
                              inv.party.whatsappNumber || inv.party.phone,
                            )}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="reminders" className="m-0">
          <div className="card-apple overflow-hidden">
            {remindersSent.length > 0 && (
              <div className="flex items-center justify-between border-b border-subtle px-8 py-4">
                <div className="text-[12.5px] text-ink-3">
                  {remindersSent.length} reminder
                  {remindersSent.length === 1 ? "" : "s"} logged — full audit trail.
                </div>
                <ExportRemindersButton
                  clientName={client.displayName}
                  rows={remindersSent.map((r) => ({
                    sentAt: formatInTimeZone(
                      r.sentAt,
                      "Asia/Kolkata",
                      "yyyy-MM-dd HH:mm:ss",
                    ),
                    debtor: r.party.mailingName || r.party.tallyLedgerName,
                    billRef: r.invoice.billRef,
                    channel: r.channel,
                    status: r.status,
                    providerId: r.providerId,
                    error: r.error,
                  }))}
                />
              </div>
            )}
            {remindersSent.length === 0 ? (
              <EmptyRow
                title="No reminders sent yet"
                body="Reminders will appear here once the cron fires for a trigger day."
              />
            ) : (
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                    <th className="px-8 py-4 text-left font-medium">Sent</th>
                    <th className="px-8 py-4 text-left font-medium">Debtor</th>
                    <th className="px-8 py-4 text-left font-medium">Invoice</th>
                    <th className="px-8 py-4 text-left font-medium">Channel</th>
                    <th className="px-8 py-4 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {remindersSent.map((r, i) => (
                    <tr
                      key={r.id}
                      className={`row-interactive ${i > 0 ? "border-t border-subtle" : "border-t border-subtle"}`}
                    >
                      <td className="tabular px-8 py-4 text-ink-3">
                        {formatInTimeZone(
                          r.sentAt,
                          "Asia/Kolkata",
                          "dd MMM yyyy, HH:mm",
                        )}
                      </td>
                      <td className="px-8 py-4 text-ink-2">
                        {r.party.mailingName || r.party.tallyLedgerName}
                      </td>
                      <td className="px-8 py-4 text-ink-2">
                        {r.invoice.billRef}
                      </td>
                      <td className="px-8 py-4">
                        <ChannelPill channel={r.channel} />
                      </td>
                      <td className="px-8 py-4">
                        <StatusPill status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-10 py-16 text-center">
      <p className="text-[16px] font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">{body}</p>
    </div>
  );
}

function ChannelBar({
  label,
  icon,
  count,
  total,
  gradient,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  total: number;
  gradient: string;
}) {
  const pct = total === 0 ? 0 : (count / total) * 100;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
          <span className="text-ink-3">{icon}</span>
          {label}
        </div>
        <div className="tabular text-[14px] font-semibold text-ink">
          {count}
          <span className="ml-1 text-ink-3">/ {total}</span>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="h-full rounded-full transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          style={{ width: `${pct}%`, background: gradient }}
        />
      </div>
      <div className="tabular mt-1 text-[11px] text-ink-3">
        {pct.toFixed(1)}%
      </div>
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
          background: "rgba(255,159,10,0.12)",
          color: "#9c5700",
        }}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "#ff9f0a" }}
        />
        Missing contact
      </span>
    );
  }
  return (
    <div className="flex items-center gap-3 text-ink-3">
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
            background: "rgba(134,134,139,0.12)",
            color: "var(--color-ink-2)",
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
    CURRENT: { bg: "rgba(48,209,88,0.12)", color: "#1f7a4a" },
    DAYS_0_30: { bg: "rgba(10,132,255,0.10)", color: "#0057b7" },
    DAYS_30_60: { bg: "rgba(255,159,10,0.14)", color: "#9c5700" },
    DAYS_60_90: { bg: "rgba(255,107,61,0.12)", color: "#a03c1b" },
    DAYS_90_PLUS: { bg: "rgba(255,69,58,0.12)", color: "#c6373a" },
  };
  const s = styles[bucket] ?? styles.CURRENT;
  return (
    <span className="pill" style={{ background: s.bg, color: s.color }}>
      {AGE_BUCKET_LABELS[bucket as keyof typeof AGE_BUCKET_LABELS] ?? bucket}
    </span>
  );
}

function ChannelPill({ channel }: { channel: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    EMAIL: { bg: "rgba(10,132,255,0.10)", color: "#0057b7" },
    WHATSAPP: { bg: "rgba(48,209,88,0.12)", color: "#1f7a4a" },
    SMS: { bg: "rgba(255,159,10,0.14)", color: "#9c5700" },
  };
  const s = styles[channel] ?? styles.EMAIL;
  return (
    <span className="pill" style={{ background: s.bg, color: s.color }}>
      {channel.toLowerCase()}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    SENT: { bg: "rgba(48,209,88,0.12)", color: "#1f7a4a" },
    DELIVERED: { bg: "rgba(48,209,88,0.18)", color: "#15603a" },
    READ: { bg: "rgba(10,132,255,0.12)", color: "#0057b7" },
    FAILED: { bg: "rgba(255,69,58,0.12)", color: "#c6373a" },
    BOUNCED: { bg: "rgba(255,69,58,0.12)", color: "#c6373a" },
  };
  const s = styles[status] ?? styles.SENT;
  return (
    <span className="pill" style={{ background: s.bg, color: s.color }}>
      {status.toLowerCase()}
    </span>
  );
}

