/** @jsxRuntime classic */
/** @jsx React.createElement */
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { LedgerStatement } from "@/lib/ledger-data";
import { buildUpiQr } from "@/lib/upi-qr";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111",
  },
  headerBand: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottom: "1pt solid #333",
    paddingBottom: 10,
    marginBottom: 14,
  },
  firmName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  firmSub: { fontSize: 8, color: "#555", marginTop: 2 },
  titleRight: { alignItems: "flex-end" },
  title: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  periodLabel: { fontSize: 8, color: "#555", marginTop: 2 },

  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 12,
  },
  metaCell: { flex: 1 },
  metaLabel: {
    fontSize: 7,
    color: "#777",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaValue: { fontSize: 10, marginTop: 2, fontFamily: "Helvetica-Bold" },
  metaSub: { fontSize: 8, color: "#555", marginTop: 1 },

  table: { marginTop: 6, border: "1pt solid #ccc" },
  tr: { flexDirection: "row", borderBottom: "0.5pt solid #e5e5e5" },
  trHead: {
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
    borderBottom: "1pt solid #aaa",
  },
  trTotals: {
    flexDirection: "row",
    backgroundColor: "#fafafa",
    borderTop: "1pt solid #aaa",
    fontFamily: "Helvetica-Bold",
  },
  td: { padding: 5, fontSize: 8.5 },
  tdHead: {
    padding: 5,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#333",
  },
  cDate: { width: "13%" },
  cVch: { width: "17%" },
  cPart: { width: "40%" },
  cDr: { width: "12%", textAlign: "right" },
  cCr: { width: "12%", textAlign: "right" },
  cBal: { width: "16%", textAlign: "right" },

  subtle: { fontSize: 8, color: "#555" },
  mutedCentered: {
    fontSize: 8,
    color: "#555",
    marginTop: 14,
    textAlign: "center",
  },

  payBlock: {
    marginTop: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    border: "1pt solid #d5d5d5",
    borderRadius: 4,
    padding: 12,
    gap: 16,
  },
  payLeft: { flex: 1 },
  payLabel: {
    fontSize: 7,
    color: "#777",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  payLine: { fontSize: 9, marginTop: 2 },
  payHeading: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  payQr: {
    width: 80,
    height: 80,
    alignSelf: "center",
  },
  payQrCaption: {
    fontSize: 7,
    color: "#777",
    textAlign: "center",
    marginTop: 4,
  },

  signatoryBlock: {
    marginTop: 22,
    paddingTop: 12,
    borderTop: "0.5pt solid #999",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  signLeft: { width: "50%" },
  signRight: { width: "40%", alignItems: "flex-end" },
  signatureSpace: {
    marginTop: 20,
    borderTop: "0.5pt solid #222",
    width: "80%",
    alignSelf: "flex-end",
    paddingTop: 4,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#888",
    textAlign: "center",
  },
});

function inr(n: number): string {
  const neg = n < 0;
  const s = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
  return neg ? `(${s})` : s;
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/**
 * Extended firm bank-details input for the "pay us" block. Kept in a
 * separate type so the PDF module doesn't import Prisma.
 */
export interface FirmPaymentDetails {
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  upiId?: string | null;
}

/**
 * Render the ledger statement PDF. Flattened — Document is constructed
 * inline inside renderToBuffer rather than wrapped in another functional
 * component. That pattern plays nicer with @react-pdf/renderer's
 * reconciler under Next.js RSC + bundler transforms (the "React error
 * #31" symptom surfaced from wrapping in a component).
 */
export async function renderLedgerPdf(
  data: LedgerStatement,
  payment?: FirmPaymentDetails,
): Promise<Buffer> {
  const firmName = data.firm.name || "";
  const partner = data.firm.partnerName || "";
  const frn = data.firm.frn || "";
  const mno = data.firm.partnerMno || "";

  // Pre-render the UPI QR so it can go into the payment block as an
  // inline data-URL. Skip if no VPA — the block collapses to bank-only.
  let qrDataUrl: string | null = null;
  if (payment?.upiId) {
    try {
      const { dataUrl } = await buildUpiQr({
        vpa: payment.upiId,
        payeeName: firmName || "CredFloat",
        amount: data.closingBalance > 0 ? data.closingBalance : undefined,
        note: `Ledger ${data.party.name.slice(0, 40)}`,
      });
      qrDataUrl = dataUrl;
    } catch {
      // silently skip QR — bank block still renders
      qrDataUrl = null;
    }
  }

  const hasPaymentBlock =
    Boolean(payment?.bankName) ||
    Boolean(payment?.bankAccountNumber) ||
    Boolean(payment?.upiId);

  return renderToBuffer(
    <Document
      title={"Ledger — " + data.party.name}
      author={firmName}
      subject="Ledger confirmation / statement"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          <View>
            <Text style={styles.firmName}>{firmName}</Text>
            <Text style={styles.firmSub}>Chartered Accountants</Text>
            {frn ? <Text style={styles.firmSub}>{"FRN: " + frn}</Text> : null}
          </View>
          <View style={styles.titleRight}>
            <Text style={styles.title}>LEDGER STATEMENT</Text>
            <Text style={styles.periodLabel}>{data.period.label}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Debtor</Text>
            <Text style={styles.metaValue}>{data.party.name}</Text>
            {data.party.address ? (
              <Text style={styles.metaSub}>{data.party.address}</Text>
            ) : null}
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>In the books of</Text>
            <Text style={styles.metaValue}>
              {data.clientCompany.displayName}
            </Text>
            <Text style={styles.metaSub}>{"Managed by " + firmName}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Period</Text>
            <Text style={styles.metaValue}>
              {data.period.from === "—"
                ? data.period.to
                : data.period.from + " → " + data.period.to}
            </Text>
            <Text style={styles.metaSub}>
              {"Generated " + formatDate(data.generatedAt)}
            </Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.trHead}>
            <Text style={[styles.tdHead, styles.cDate]}>Date</Text>
            <Text style={[styles.tdHead, styles.cVch]}>Voucher</Text>
            <Text style={[styles.tdHead, styles.cPart]}>Particulars</Text>
            <Text style={[styles.tdHead, styles.cDr]}>Debit</Text>
            <Text style={[styles.tdHead, styles.cCr]}>Credit</Text>
            <Text style={[styles.tdHead, styles.cBal]}>Balance</Text>
          </View>

          <View style={styles.tr}>
            <Text style={[styles.td, styles.cDate]}>—</Text>
            <Text style={[styles.td, styles.cVch]}>—</Text>
            <Text style={[styles.td, styles.cPart]}>Opening balance</Text>
            <Text style={[styles.td, styles.cDr]}>—</Text>
            <Text style={[styles.td, styles.cCr]}>—</Text>
            <Text style={[styles.td, styles.cBal]}>
              {inr(data.openingBalance)}
            </Text>
          </View>

          {data.rows.map((r, i) => (
            <View key={i} style={styles.tr}>
              <Text style={[styles.td, styles.cDate]}>{formatDate(r.date)}</Text>
              <Text style={[styles.td, styles.cVch]}>{r.voucher}</Text>
              <Text style={[styles.td, styles.cPart]}>{r.particulars}</Text>
              <Text style={[styles.td, styles.cDr]}>
                {r.debit > 0 ? inr(r.debit) : ""}
              </Text>
              <Text style={[styles.td, styles.cCr]}>
                {r.credit > 0 ? inr(r.credit) : ""}
              </Text>
              <Text style={[styles.td, styles.cBal]}>
                {inr(r.runningBalance)}
              </Text>
            </View>
          ))}

          <View style={styles.trTotals}>
            <Text style={[styles.td, styles.cDate]}>{""}</Text>
            <Text style={[styles.td, styles.cVch]}>{""}</Text>
            <Text style={[styles.td, styles.cPart]}>
              Totals · closing balance
            </Text>
            <Text style={[styles.td, styles.cDr]}>
              {inr(data.totals.debit)}
            </Text>
            <Text style={[styles.td, styles.cCr]}>
              {inr(data.totals.credit)}
            </Text>
            <Text style={[styles.td, styles.cBal]}>
              {inr(data.closingBalance)}
            </Text>
          </View>
        </View>

        {data.rows.length === 0 ? (
          <Text style={styles.mutedCentered}>
            {"No transactions in this period. Closing balance " +
              inr(data.closingBalance) +
              "."}
          </Text>
        ) : null}

        {hasPaymentBlock ? (
          <View style={styles.payBlock}>
            <View style={styles.payLeft}>
              <Text style={styles.payHeading}>Pay us</Text>
              {payment?.bankName ? (
                <View>
                  <Text style={styles.payLabel}>Bank</Text>
                  <Text style={styles.payLine}>{payment.bankName}</Text>
                </View>
              ) : null}
              {payment?.bankAccountName ? (
                <View style={{ marginTop: 6 }}>
                  <Text style={styles.payLabel}>Account name</Text>
                  <Text style={styles.payLine}>{payment.bankAccountName}</Text>
                </View>
              ) : null}
              {payment?.bankAccountNumber ? (
                <View style={{ marginTop: 6 }}>
                  <Text style={styles.payLabel}>Account number</Text>
                  <Text style={styles.payLine}>{payment.bankAccountNumber}</Text>
                </View>
              ) : null}
              {payment?.bankIfsc ? (
                <View style={{ marginTop: 6 }}>
                  <Text style={styles.payLabel}>IFSC</Text>
                  <Text style={styles.payLine}>{payment.bankIfsc}</Text>
                </View>
              ) : null}
              {payment?.upiId ? (
                <View style={{ marginTop: 6 }}>
                  <Text style={styles.payLabel}>UPI</Text>
                  <Text style={styles.payLine}>{payment.upiId}</Text>
                </View>
              ) : null}
            </View>
            {qrDataUrl ? (
              <View>
                <Image src={qrDataUrl} style={styles.payQr} />
                <Text style={styles.payQrCaption}>Scan any UPI app</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.signatoryBlock}>
          <View style={styles.signLeft}>
            <Text style={styles.subtle}>
              {"This statement is computer-generated from Tally data synced on " +
                formatDate(data.generatedAt) +
                ". Please reconcile and revert within 7 days of receipt."}
            </Text>
          </View>
          <View style={styles.signRight}>
            <Text style={styles.subtle}>{"For " + firmName}</Text>
            <Text style={styles.subtle}>Chartered Accountants</Text>
            <View style={styles.signatureSpace}>
              <Text style={styles.subtle}>
                {partner ? partner : "Partner signature"}
              </Text>
              {mno ? (
                <Text style={styles.subtle}>{"M.No. " + mno}</Text>
              ) : null}
            </View>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          {firmName +
            (frn ? " · FRN " + frn : "") +
            " · Confidential · Ledger as of " +
            formatDate(data.generatedAt)}
        </Text>
      </Page>
    </Document>,
  );
}
