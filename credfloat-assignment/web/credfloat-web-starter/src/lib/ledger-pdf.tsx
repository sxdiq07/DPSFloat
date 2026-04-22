import { createRequire } from "node:module";
import type { LedgerStatement } from "@/lib/ledger-data";
import { buildUpiQr } from "@/lib/upi-qr";

/**
 * PDF render.
 *
 * Next.js 15 ships its own bundled React at `next/dist/compiled/react`
 * and aliases imports from server-side code to that copy. Meanwhile
 * @react-pdf/renderer does `require("react")` which resolves to the
 * app's node_modules/react. The two Reacts are different instances,
 * so element $$typeof symbols don't match and every renderToBuffer
 * call explodes with React error #31.
 *
 * Workaround: use Node's runtime `createRequire` to resolve BOTH
 * React and @react-pdf/renderer through the same module resolver
 * Node uses. No bundling, no aliasing, same React instance on both
 * sides of the reconciler.
 */

const nodeRequire = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const React: any = nodeRequire("react");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactPDF: any = nodeRequire("@react-pdf/renderer");

const { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } =
  ReactPDF;

const h = React.createElement;

export interface FirmPaymentDetails {
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  upiId?: string | null;
}

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottom: "1pt solid #333",
    paddingBottom: 10,
    marginBottom: 14,
  },
  firmName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  firmSub: { fontSize: 8, color: "#555", marginTop: 2 },
  title: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "right" },
  periodLabel: { fontSize: 8, color: "#555", marginTop: 2, textAlign: "right" },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  metaCell: { flex: 1, paddingRight: 12 },
  metaLabel: { fontSize: 7, color: "#777", textTransform: "uppercase" },
  metaValue: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 2 },
  metaSub: { fontSize: 8, color: "#555", marginTop: 1 },
  table: { border: "1pt solid #ccc", marginTop: 6 },
  thead: {
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
    borderBottom: "1pt solid #aaa",
  },
  tr: { flexDirection: "row", borderBottom: "0.5pt solid #e5e5e5" },
  trTotals: {
    flexDirection: "row",
    borderTop: "1pt solid #aaa",
    backgroundColor: "#fafafa",
  },
  th: { padding: 5, fontSize: 8, fontFamily: "Helvetica-Bold" },
  td: { padding: 5, fontSize: 8.5 },
  cDate: { width: "13%" },
  cVch: { width: "17%" },
  cPart: { width: "40%" },
  cDr: { width: "12%", textAlign: "right" },
  cCr: { width: "12%", textAlign: "right" },
  cBal: { width: "16%", textAlign: "right" },
  payBlock: {
    marginTop: 22,
    padding: 12,
    border: "1pt solid #d5d5d5",
    borderRadius: 4,
    flexDirection: "row",
  },
  payLeft: { flex: 1 },
  payHeading: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  payLabel: { fontSize: 7, color: "#777", textTransform: "uppercase" },
  payLine: { fontSize: 9, marginTop: 2 },
  payQr: { width: 80, height: 80 },
  payQrCaption: { fontSize: 7, color: "#777", textAlign: "center", marginTop: 4 },
  sign: {
    marginTop: 20,
    paddingTop: 12,
    borderTop: "0.5pt solid #999",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  signL: { width: "55%" },
  signR: { width: "40%", alignItems: "flex-end" },
  signLine: {
    marginTop: 20,
    borderTop: "0.5pt solid #222",
    paddingTop: 4,
    width: "80%",
    alignSelf: "flex-end",
  },
  subtle: { fontSize: 8, color: "#555" },
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

function line(label: string, value?: string | null) {
  if (!value) return null;
  return h(
    View,
    { style: { marginTop: 4 } },
    h(Text, { style: styles.payLabel }, label),
    h(Text, { style: styles.payLine }, value),
  );
}

export async function renderLedgerPdf(
  data: LedgerStatement,
  payment?: FirmPaymentDetails,
): Promise<Buffer> {
  const firmName = data.firm.name || "";
  const frn = data.firm.frn || "";
  const partner = data.firm.partnerName || "";
  const mno = data.firm.partnerMno || "";

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
      qrDataUrl = null;
    }
  }

  const hasPay =
    Boolean(payment?.bankName) ||
    Boolean(payment?.bankAccountNumber) ||
    Boolean(payment?.upiId);

  const header = h(
    View,
    { style: styles.header },
    h(
      View,
      null,
      h(Text, { style: styles.firmName }, firmName),
      h(Text, { style: styles.firmSub }, "Chartered Accountants"),
      frn ? h(Text, { style: styles.firmSub }, "FRN: " + frn) : null,
    ),
    h(
      View,
      null,
      h(Text, { style: styles.title }, "LEDGER STATEMENT"),
      h(Text, { style: styles.periodLabel }, data.period.label),
    ),
  );

  const meta = h(
    View,
    { style: styles.metaRow },
    h(
      View,
      { style: styles.metaCell },
      h(Text, { style: styles.metaLabel }, "Debtor"),
      h(Text, { style: styles.metaValue }, data.party.name),
      data.party.address
        ? h(Text, { style: styles.metaSub }, data.party.address)
        : null,
    ),
    h(
      View,
      { style: styles.metaCell },
      h(Text, { style: styles.metaLabel }, "In the books of"),
      h(Text, { style: styles.metaValue }, data.clientCompany.displayName),
      h(Text, { style: styles.metaSub }, "Managed by " + firmName),
    ),
    h(
      View,
      { style: styles.metaCell },
      h(Text, { style: styles.metaLabel }, "Period"),
      h(
        Text,
        { style: styles.metaValue },
        data.period.from === "—"
          ? data.period.to
          : data.period.from + " → " + data.period.to,
      ),
      h(
        Text,
        { style: styles.metaSub },
        "Generated " + formatDate(data.generatedAt),
      ),
    ),
  );

  const headRow = h(
    View,
    { style: styles.thead },
    h(Text, { style: [styles.th, styles.cDate] }, "Date"),
    h(Text, { style: [styles.th, styles.cVch] }, "Voucher"),
    h(Text, { style: [styles.th, styles.cPart] }, "Particulars"),
    h(Text, { style: [styles.th, styles.cDr] }, "Debit"),
    h(Text, { style: [styles.th, styles.cCr] }, "Credit"),
    h(Text, { style: [styles.th, styles.cBal] }, "Balance"),
  );

  const openingRow = h(
    View,
    { style: styles.tr },
    h(Text, { style: [styles.td, styles.cDate] }, "—"),
    h(Text, { style: [styles.td, styles.cVch] }, "—"),
    h(Text, { style: [styles.td, styles.cPart] }, "Opening balance"),
    h(Text, { style: [styles.td, styles.cDr] }, "—"),
    h(Text, { style: [styles.td, styles.cCr] }, "—"),
    h(Text, { style: [styles.td, styles.cBal] }, inr(data.openingBalance)),
  );

  const dataRows = data.rows.map((r, i) =>
    h(
      View,
      { key: "r" + i, style: styles.tr },
      h(Text, { style: [styles.td, styles.cDate] }, formatDate(r.date)),
      h(Text, { style: [styles.td, styles.cVch] }, r.voucher),
      h(Text, { style: [styles.td, styles.cPart] }, r.particulars),
      h(
        Text,
        { style: [styles.td, styles.cDr] },
        r.debit > 0 ? inr(r.debit) : "",
      ),
      h(
        Text,
        { style: [styles.td, styles.cCr] },
        r.credit > 0 ? inr(r.credit) : "",
      ),
      h(Text, { style: [styles.td, styles.cBal] }, inr(r.runningBalance)),
    ),
  );

  const totalsRow = h(
    View,
    { style: styles.trTotals },
    h(Text, { style: [styles.td, styles.cDate] }, ""),
    h(Text, { style: [styles.td, styles.cVch] }, ""),
    h(Text, { style: [styles.td, styles.cPart] }, "Totals · closing balance"),
    h(Text, { style: [styles.td, styles.cDr] }, inr(data.totals.debit)),
    h(Text, { style: [styles.td, styles.cCr] }, inr(data.totals.credit)),
    h(Text, { style: [styles.td, styles.cBal] }, inr(data.closingBalance)),
  );

  const table = h(
    View,
    { style: styles.table },
    headRow,
    openingRow,
    ...dataRows,
    totalsRow,
  );

  const payBlock = hasPay
    ? h(
        View,
        { style: styles.payBlock },
        h(
          View,
          { style: styles.payLeft },
          h(Text, { style: styles.payHeading }, "Pay us"),
          line("Bank", payment?.bankName),
          line("Account name", payment?.bankAccountName),
          line("Account number", payment?.bankAccountNumber),
          line("IFSC", payment?.bankIfsc),
          line("UPI", payment?.upiId),
        ),
        qrDataUrl
          ? h(
              View,
              null,
              h(Image, { src: qrDataUrl, style: styles.payQr }),
              h(Text, { style: styles.payQrCaption }, "Scan any UPI app"),
            )
          : null,
      )
    : null;

  const signatory = h(
    View,
    { style: styles.sign },
    h(
      View,
      { style: styles.signL },
      h(
        Text,
        { style: styles.subtle },
        "This statement is computer-generated from Tally data synced on " +
          formatDate(data.generatedAt) +
          ". Please reconcile and revert within 7 days of receipt.",
      ),
    ),
    h(
      View,
      { style: styles.signR },
      h(Text, { style: styles.subtle }, "For " + firmName),
      h(Text, { style: styles.subtle }, "Chartered Accountants"),
      h(
        View,
        { style: styles.signLine },
        h(Text, { style: styles.subtle }, partner || "Partner signature"),
        mno ? h(Text, { style: styles.subtle }, "M.No. " + mno) : null,
      ),
    ),
  );

  const footer = h(
    Text,
    { style: styles.footer, fixed: true },
    firmName +
      (frn ? " · FRN " + frn : "") +
      " · Confidential · Ledger as of " +
      formatDate(data.generatedAt),
  );

  const page = h(
    Page,
    { size: "A4", style: styles.page },
    header,
    meta,
    table,
    payBlock,
    signatory,
    footer,
  );

  const doc = h(
    Document,
    {
      title: "Ledger — " + data.party.name,
      author: firmName,
      subject: "Ledger confirmation / statement",
    },
    page,
  );

  return renderToBuffer(doc);
}
