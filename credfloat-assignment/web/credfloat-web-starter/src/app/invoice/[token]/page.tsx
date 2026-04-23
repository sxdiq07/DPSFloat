import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyInvoiceToken } from "@/lib/invoice-token";
import { formatINR } from "@/lib/currency";
import { buildUpiUri, buildUpiQr } from "@/lib/upi-qr";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public one-invoice view. Reached via a signed HMAC token so no
 * auth needed, but each URL only shows ONE bill — doesn't leak
 * other debtors' data or the rest of a party's ledger.
 */
export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = verifyInvoiceToken(token);
  if (!payload) notFound();

  const invoice = await prisma.invoice.findUnique({
    where: { id: payload.invoiceId },
    include: {
      party: true,
      clientCompany: { include: { firm: true } },
    },
  });
  if (!invoice || invoice.deletedAt) notFound();

  const firm = invoice.clientCompany.firm;
  const outstanding = Number(invoice.outstandingAmount);

  let qrDataUrl: string | null = null;
  let upiUri: string | null = null;
  if (firm.upiId) {
    upiUri = buildUpiUri({
      vpa: firm.upiId,
      payeeName: firm.bankAccountName || firm.name,
      amount: outstanding,
      note: `Inv ${invoice.billRef}`,
    });
    try {
      const qr = await buildUpiQr({
        vpa: firm.upiId,
        payeeName: firm.bankAccountName || firm.name,
        amount: outstanding,
        note: `Inv ${invoice.billRef}`,
      });
      qrDataUrl = qr.dataUrl;
    } catch {
      qrDataUrl = null;
    }
  }

  const partyName = invoice.party.mailingName || invoice.party.tallyLedgerName;
  const dueDate = invoice.dueDate
    ? formatInTimeZone(invoice.dueDate, "Asia/Kolkata", "dd MMM yyyy")
    : "—";
  const billDate = formatInTimeZone(
    invoice.billDate,
    "Asia/Kolkata",
    "dd MMM yyyy",
  );

  return (
    <main
      className="min-h-screen bg-[var(--color-surface)] px-6 py-10"
      style={{ background: "#fbfbfd" }}
    >
      <div className="mx-auto max-w-xl space-y-6">
        {/* Header */}
        <header className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Payment reminder
          </p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            Invoice {invoice.billRef}
          </h1>
          <p className="text-[14px] text-ink-3">
            From{" "}
            <span className="font-medium text-ink-2">
              {invoice.clientCompany.displayName}
            </span>{" "}
            — managed by {firm.name}
          </p>
        </header>

        {/* Amount */}
        <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-white p-7 shadow-[var(--shadow-apple-sm)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Amount due
          </div>
          <div className="tabular mt-2 text-[40px] font-semibold leading-none text-ink">
            <span
              className="mr-2 text-[22px] font-medium text-ink-3"
              style={{ letterSpacing: "0.02em" }}
            >
              INR
            </span>
            {new Intl.NumberFormat("en-IN", {
              maximumFractionDigits: 0,
            }).format(outstanding)}
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 text-[13px]">
            <div>
              <dt className="text-ink-3">Billed to</dt>
              <dd className="mt-0.5 font-medium text-ink">{partyName}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Bill date</dt>
              <dd className="mt-0.5 font-medium text-ink">{billDate}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Due date</dt>
              <dd className="mt-0.5 font-medium text-ink">{dueDate}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Invoice #</dt>
              <dd className="tabular mt-0.5 font-medium text-ink">
                {invoice.billRef}
              </dd>
            </div>
          </dl>
        </section>

        {/* Pay — UPI QR + bank */}
        {(firm.upiId || firm.bankAccountNumber) && (
          <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-white p-7 shadow-[var(--shadow-apple-sm)]">
            <h2 className="text-[18px] font-semibold tracking-tight text-ink">
              Pay securely
            </h2>

            {firm.upiId && qrDataUrl && (
              <div className="mt-5 grid grid-cols-[auto_1fr] items-center gap-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt="UPI QR"
                  width={160}
                  height={160}
                  style={{
                    background: "white",
                    border: "1px solid #e8e8ed",
                    borderRadius: 12,
                    padding: 8,
                  }}
                />
                <div className="space-y-1 text-[13px]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    UPI
                  </div>
                  <div className="tabular font-medium text-ink">
                    {firm.upiId}
                  </div>
                  <div className="text-ink-3">
                    Scan with GPay / PhonePe / Paytm / any UPI app.
                  </div>
                  {upiUri && (
                    <a
                      href={upiUri}
                      className="mt-2 inline-block text-[13px] font-medium text-[var(--color-accent-blue)] hover:underline"
                    >
                      Or tap to open in your UPI app →
                    </a>
                  )}
                </div>
              </div>
            )}

            {firm.bankAccountNumber && (
              <div className="mt-5 border-t border-subtle pt-5 space-y-1 text-[13px]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                  Bank transfer
                </div>
                {firm.bankAccountName && (
                  <div>
                    <span className="text-ink-3">Account name:</span>{" "}
                    <span className="font-medium text-ink">
                      {firm.bankAccountName}
                    </span>
                  </div>
                )}
                <div className="tabular">
                  <span className="text-ink-3">A/C:</span>{" "}
                  <span className="font-medium text-ink">
                    {firm.bankAccountNumber}
                  </span>
                </div>
                {firm.bankIfsc && (
                  <div className="tabular">
                    <span className="text-ink-3">IFSC:</span>{" "}
                    <span className="font-medium text-ink">{firm.bankIfsc}</span>
                  </div>
                )}
                {firm.bankName && (
                  <div className="text-ink-3">{firm.bankName}</div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Footer */}
        <footer className="pt-4 text-center text-[11px] text-ink-3">
          Secured by Ledger · signed link valid 48h. If the amount or
          details look wrong, please contact {firm.name} directly.
        </footer>
      </div>
    </main>
  );
}
