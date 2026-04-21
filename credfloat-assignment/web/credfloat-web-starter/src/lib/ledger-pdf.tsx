import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";
import type { LedgerStatement } from "@/lib/ledger-data";

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
  title: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "right" },
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

export function LedgerPdf({ data }: { data: LedgerStatement }) {
  const firmName = data.firm.name;
  const partner = data.firm.partnerName ?? "";
  const frn = data.firm.frn ?? "";
  const mno = data.firm.partnerMno ?? "";

  return (
    <Document
      title={`Ledger — ${data.party.name}`}
      author={firmName}
      subject="Ledger confirmation / statement"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          <View>
            <Text style={styles.firmName}>{firmName}</Text>
            <Text style={styles.firmSub}>Chartered Accountants</Text>
            {frn ? <Text style={styles.firmSub}>FRN: {frn}</Text> : null}
          </View>
          <View>
            <Text style={styles.title}>LEDGER STATEMENT</Text>
            <Text style={[styles.subtle, { textAlign: "right", marginTop: 2 }]}>
              {data.period.label}
            </Text>
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
            <Text style={styles.metaSub}>
              Managed by {firmName}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Period</Text>
            <Text style={styles.metaValue}>
              {data.period.from === "—"
                ? data.period.to
                : `${data.period.from} → ${data.period.to}`}
            </Text>
            <Text style={styles.metaSub}>
              Generated {formatDate(data.generatedAt)}
            </Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.trHead}>
            <Text style={[styles.tdHead, styles.cDate]}>Date</Text>
            <Text style={[styles.tdHead, styles.cVch]}>Voucher</Text>
            <Text style={[styles.tdHead, styles.cPart]}>Particulars</Text>
            <Text style={[styles.tdHead, styles.cDr]}>Debit (₹)</Text>
            <Text style={[styles.tdHead, styles.cCr]}>Credit (₹)</Text>
            <Text style={[styles.tdHead, styles.cBal]}>Balance (₹)</Text>
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
            <Text style={[styles.td, styles.cDate]}></Text>
            <Text style={[styles.td, styles.cVch]}></Text>
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
          <Text style={[styles.subtle, { marginTop: 14, textAlign: "center" }]}>
            No transactions in this period. Closing balance {inr(data.closingBalance)}.
          </Text>
        ) : null}

        <View style={styles.signatoryBlock}>
          <View style={styles.signLeft}>
            <Text style={styles.subtle}>
              This statement is computer-generated from Tally data synced on{" "}
              {formatDate(data.generatedAt)}. Please reconcile and revert within
              7 days of receipt.
            </Text>
          </View>
          <View style={styles.signRight}>
            <Text style={styles.subtle}>For {firmName}</Text>
            <Text style={styles.subtle}>Chartered Accountants</Text>
            <View style={styles.signatureSpace}>
              <Text style={styles.subtle}>
                {partner ? partner : "Partner signature"}
              </Text>
              {mno ? (
                <Text style={styles.subtle}>M.No. {mno}</Text>
              ) : null}
            </View>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          {firmName}
          {frn ? ` · FRN ${frn}` : ""} · Confidential · Ledger as of{" "}
          {formatDate(data.generatedAt)}
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Server-side render — returns a raw PDF Buffer. Used by the
 * /api/ledger/[token] route and by any reminder dispatch that needs
 * the PDF inline as an email attachment.
 */
export async function renderLedgerPdf(data: LedgerStatement): Promise<Buffer> {
  return renderToBuffer(<LedgerPdf data={data} />);
}
