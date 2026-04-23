import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInvoiceToken } from "@/lib/invoice-token";
import { formatINR } from "@/lib/currency";
import { buildUpiQr } from "@/lib/upi-qr";
import { formatInTimeZone } from "date-fns-tz";

export const runtime = "nodejs";

/**
 * Signed public PDF for a single invoice. Mirrors the ledger PDF
 * route but only shows ONE bill + payment instructions.
 *
 * PDF rendering uses @react-pdf/renderer via a deferred dynamic
 * import (same pattern as ledger-pdf.tsx) so it never gets bundled
 * with the Next.js edge build.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const payload = verifyInvoiceToken(token);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid or expired invoice token" },
      { status: 401 },
    );
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: payload.invoiceId },
    include: {
      party: true,
      clientCompany: { include: { firm: true } },
    },
  });
  if (!invoice || invoice.deletedAt) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  let qrDataUrl: string | null = null;
  const firm = invoice.clientCompany.firm;
  if (firm.upiId) {
    try {
      const qr = await buildUpiQr({
        vpa: firm.upiId,
        payeeName: firm.bankAccountName || firm.name,
        amount: Number(invoice.outstandingAmount),
        note: `Inv ${invoice.billRef}`,
      });
      qrDataUrl = qr.dataUrl;
    } catch {
      qrDataUrl = null;
    }
  }

  // Dynamic imports — see ledger-pdf.tsx for why these use
  // webpackIgnore (bundler would produce two React copies otherwise).
  const reactMod = await import(/* webpackIgnore: true */ "react");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const React: any =
    (reactMod as { default?: unknown }).default ?? reactMod;
  const pdfMod = await import(/* webpackIgnore: true */ "@react-pdf/renderer");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = pdfMod as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ReactPDF: any =
    typeof m.renderToBuffer === "function"
      ? m
      : m.default?.renderToBuffer
        ? m.default
        : { ...(m.default ?? {}), ...m };
  const { Document, Page, Text, View, StyleSheet, Image } = ReactPDF;

  const styles = StyleSheet.create({
    page: { padding: 40, fontSize: 11, color: "#1d1d1f", fontFamily: "Helvetica" },
    eyebrow: {
      fontSize: 9,
      letterSpacing: 1.4,
      color: "#86868b",
      textTransform: "uppercase",
    },
    h1: { fontSize: 22, fontWeight: 700, marginTop: 6, color: "#1d1d1f" },
    sub: { fontSize: 11, color: "#424245", marginTop: 3 },
    card: {
      marginTop: 18,
      padding: 16,
      borderRadius: 8,
      border: "1px solid #e8e8ed",
    },
    kvGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 10 },
    kv: { width: "50%", marginTop: 8 },
    kvLabel: { fontSize: 9, color: "#86868b" },
    kvVal: { fontSize: 12, color: "#1d1d1f", marginTop: 2, fontWeight: 500 },
    amount: { fontSize: 28, fontWeight: 700, marginTop: 6, color: "#1d1d1f" },
    qrRow: { flexDirection: "row", alignItems: "center", marginTop: 14 },
    qr: { width: 120, height: 120, marginRight: 16 },
    h2: { fontSize: 13, fontWeight: 600, marginBottom: 6 },
    bankLine: { fontSize: 11, color: "#424245", marginTop: 2 },
    footer: {
      marginTop: 24,
      fontSize: 9,
      color: "#86868b",
      textAlign: "center",
    },
  });

  const partyName = invoice.party.mailingName || invoice.party.tallyLedgerName;
  const dueDate = invoice.dueDate
    ? formatInTimeZone(invoice.dueDate, "Asia/Kolkata", "dd MMM yyyy")
    : "—";
  const billDate = formatInTimeZone(
    invoice.billDate,
    "Asia/Kolkata",
    "dd MMM yyyy",
  );

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.eyebrow }, "Payment reminder"),
      React.createElement(
        Text,
        { style: styles.h1 },
        `Invoice ${invoice.billRef}`,
      ),
      React.createElement(
        Text,
        { style: styles.sub },
        `From ${invoice.clientCompany.displayName} — managed by ${firm.name}`,
      ),
      React.createElement(
        View,
        { style: styles.card },
        React.createElement(Text, { style: styles.eyebrow }, "Amount due"),
        React.createElement(
          Text,
          { style: styles.amount },
          formatINR(Number(invoice.outstandingAmount)),
        ),
        React.createElement(
          View,
          { style: styles.kvGrid },
          React.createElement(
            View,
            { style: styles.kv },
            React.createElement(Text, { style: styles.kvLabel }, "Billed to"),
            React.createElement(Text, { style: styles.kvVal }, partyName),
          ),
          React.createElement(
            View,
            { style: styles.kv },
            React.createElement(Text, { style: styles.kvLabel }, "Bill date"),
            React.createElement(Text, { style: styles.kvVal }, billDate),
          ),
          React.createElement(
            View,
            { style: styles.kv },
            React.createElement(Text, { style: styles.kvLabel }, "Due date"),
            React.createElement(Text, { style: styles.kvVal }, dueDate),
          ),
          React.createElement(
            View,
            { style: styles.kv },
            React.createElement(Text, { style: styles.kvLabel }, "Invoice #"),
            React.createElement(Text, { style: styles.kvVal }, invoice.billRef),
          ),
        ),
      ),
      (firm.upiId || firm.bankAccountNumber) &&
        React.createElement(
          View,
          { style: styles.card },
          React.createElement(Text, { style: styles.h2 }, "Pay securely"),
          qrDataUrl &&
            React.createElement(
              View,
              { style: styles.qrRow },
              React.createElement(Image, { src: qrDataUrl, style: styles.qr }),
              React.createElement(
                View,
                null,
                React.createElement(Text, { style: styles.kvLabel }, "UPI"),
                React.createElement(
                  Text,
                  { style: styles.kvVal },
                  firm.upiId,
                ),
                React.createElement(
                  Text,
                  { style: styles.bankLine },
                  "Scan with any UPI app.",
                ),
              ),
            ),
          firm.bankAccountNumber &&
            React.createElement(
              View,
              { style: { marginTop: 10 } },
              React.createElement(
                Text,
                { style: styles.kvLabel },
                "Bank transfer",
              ),
              firm.bankAccountName &&
                React.createElement(
                  Text,
                  { style: styles.bankLine },
                  `${firm.bankAccountName}`,
                ),
              React.createElement(
                Text,
                { style: styles.bankLine },
                `A/C ${firm.bankAccountNumber}`,
              ),
              firm.bankIfsc &&
                React.createElement(
                  Text,
                  { style: styles.bankLine },
                  `IFSC ${firm.bankIfsc}`,
                ),
              firm.bankName &&
                React.createElement(
                  Text,
                  { style: styles.bankLine },
                  firm.bankName,
                ),
            ),
        ),
      React.createElement(
        Text,
        { style: styles.footer },
        `Signed link valid 48h · ${firm.name}`,
      ),
    ),
  );

  let pdf: Buffer;
  try {
    pdf = await ReactPDF.renderToBuffer(doc);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[INVOICE_PDF_ERROR]", invoice.id, msg);
    return NextResponse.json(
      { error: "Failed to render invoice PDF", detail: msg },
      { status: 500 },
    );
  }

  const safe = partyName.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40);
  const filename = `invoice_${invoice.billRef.replace(/[^A-Za-z0-9_-]+/g, "_")}_${safe}.pdf`;

  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
