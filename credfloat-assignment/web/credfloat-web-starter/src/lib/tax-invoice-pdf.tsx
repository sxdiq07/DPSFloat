/**
 * Tally-style Tax Invoice PDF for CREDFLOAT-origin invoices.
 *
 * Layout mirrors the standard Indian GST Tax Invoice format that
 * Tally Prime prints — supplier block top-left with GSTIN + state
 * code, metadata grid top-right, consignee + buyer blocks, line-
 * items table with HSN/Qty/Rate/per/Amount, CGST/SGST rows, tax
 * summary table, amount-in-words, PAN, declaration, signatory.
 *
 * Uses @react-pdf/renderer via dynamic import (same webpackIgnore
 * pattern used elsewhere in the codebase to avoid double-React
 * bundling in Next.js).
 */

import { formatInTimeZone } from "date-fns-tz";
import { numberToWordsINR } from "@/lib/gst";

export type TaxInvoiceData = {
  supplier: {
    displayName: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    stateName: string | null;
    pincode: string | null;
    gstin: string | null;
    pan: string | null;
  };
  consignee: {
    name: string;
    address: string | null;
    stateName: string | null;
    gstin: string | null;
  };
  buyer: {
    name: string;
    address: string | null;
    stateName: string | null;
    gstin: string | null;
  };
  invoice: {
    billRef: string;
    billDate: Date;
    deliveryNote: string | null;
    modeOfPayment: string | null;
    buyerOrderRef: string | null;
    buyerOrderDate: Date | null;
    dispatchDocNo: string | null;
    dispatchThrough: string | null;
    destination: string | null;
    termsOfDelivery: string | null;
  };
  items: Array<{
    description: string;
    hsnSac: string | null;
    unit: string | null;
    quantity: number;
    rate: number;
    amount: number;
    gstRate: number;
  }>;
  totals: {
    taxableTotal: number;
    cgstTotal: number;
    sgstTotal: number;
    igstTotal: number;
    grandTotal: number;
    isIntraState: boolean;
  };
  signatoryLabel: string; // e.g., "for M-TRADING CO."
};

function fmtDate(d: Date): string {
  return formatInTimeZone(d, "Asia/Kolkata", "d-MMM-yy");
}

// Rupee glyph is `₹` (U+20B9) — Helvetica in @react-pdf has it.
// We use the same glyph here as in the web-side Tally ledger PDF,
// which has rendered fine for months. If we ever see a rendering
// regression on a specific Windows font, switch to "INR " prefix.
function fmtINR(n: number): string {
  return `₹ ${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)}`;
}

/**
 * Derive PAN from GSTIN. GSTIN format: SSPPPPPPPPPPEZCZ where
 * characters 3–12 (0-indexed 2–11) are the PAN. Used when the
 * supplier PAN isn't set explicitly.
 */
export function panFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 12) return null;
  return gstin.slice(2, 12);
}

function stateCode(stateName: string | null | undefined): string {
  if (!stateName) return "";
  const match = stateName.match(/\b(\d{2})\b/);
  if (match) return match[1];
  // Lookup-by-name could be added; for now just return whatever
  // the caller typed — Tally users usually include a code.
  return "";
}

export async function renderTaxInvoicePdf(
  data: TaxInvoiceData,
): Promise<Buffer> {
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
  const { Document, Page, Text, View, StyleSheet } = ReactPDF;

  const styles = StyleSheet.create({
    page: {
      padding: 24,
      fontSize: 9,
      fontFamily: "Helvetica",
      color: "#1d1d1f",
    },
    title: {
      textAlign: "center",
      fontSize: 11,
      fontWeight: 700,
      marginBottom: 4,
    },
    outer: { borderWidth: 1, borderColor: "#000" },
    // Top — supplier block on left, metadata grid on right
    topRow: { flexDirection: "row" },
    supplierBlock: {
      flex: 1,
      padding: 6,
      borderRightWidth: 1,
      borderColor: "#000",
    },
    supplierName: { fontSize: 10, fontWeight: 700 },
    metaGrid: { flex: 1 },
    metaRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderColor: "#000",
    },
    metaCell: {
      flex: 1,
      padding: 4,
      minHeight: 28,
    },
    metaCellBorder: {
      flex: 1,
      padding: 4,
      minHeight: 28,
      borderRightWidth: 1,
      borderColor: "#000",
    },
    metaLabel: { fontSize: 8, color: "#555" },
    metaVal: { fontSize: 10, fontWeight: 700, marginTop: 1 },
    // Consignee / Buyer
    addrBlock: {
      padding: 6,
      borderTopWidth: 1,
      borderColor: "#000",
    },
    addrLabel: { fontSize: 8, color: "#555" },
    addrName: { fontSize: 10, fontWeight: 700, marginTop: 2 },
    addrLine: { fontSize: 9, marginTop: 1 },
    // Items table
    itemsHeader: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderColor: "#000",
      backgroundColor: "#f5f5f5",
      minHeight: 20,
    },
    itemsRow: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderColor: "#000",
      minHeight: 18,
    },
    col: { padding: 3, fontSize: 9 },
    col_sl: { width: 20, padding: 3, fontSize: 9, textAlign: "center" },
    col_desc: { flex: 3, padding: 3, fontSize: 9 },
    col_hsn: { width: 55, padding: 3, fontSize: 9, borderLeftWidth: 1, borderColor: "#000" },
    col_qty: { width: 55, padding: 3, fontSize: 9, textAlign: "right", borderLeftWidth: 1, borderColor: "#000" },
    col_rate: { width: 50, padding: 3, fontSize: 9, textAlign: "right", borderLeftWidth: 1, borderColor: "#000" },
    col_per: { width: 30, padding: 3, fontSize: 9, textAlign: "center", borderLeftWidth: 1, borderColor: "#000" },
    col_amt: { width: 75, padding: 3, fontSize: 9, textAlign: "right", borderLeftWidth: 1, borderColor: "#000" },
    descBold: { fontWeight: 700 },
    taxLine: { fontStyle: "italic", fontSize: 9 },
    // Totals row
    totalRow: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderColor: "#000",
      fontWeight: 700,
      minHeight: 22,
    },
    amountWordsRow: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderColor: "#000",
      padding: 4,
      justifyContent: "space-between",
    },
    amountWords: { fontSize: 9, fontStyle: "italic" },
    // HSN tax summary (bottom table)
    hsnTable: {
      borderTopWidth: 1,
      borderColor: "#000",
    },
    hsnHeader: {
      flexDirection: "row",
      backgroundColor: "#f5f5f5",
      minHeight: 22,
    },
    hsnSubHeader: { flexDirection: "row", minHeight: 18 },
    hsnRow: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderColor: "#000",
      minHeight: 18,
    },
    hsnCol_hsn: { width: 90, padding: 3, fontSize: 9, borderRightWidth: 1, borderColor: "#000" },
    hsnCol_taxable: { width: 80, padding: 3, fontSize: 9, textAlign: "right", borderRightWidth: 1, borderColor: "#000" },
    hsnCol_tax: { flex: 1, padding: 3, fontSize: 9, textAlign: "center", borderRightWidth: 1, borderColor: "#000" },
    hsnCol_total: { width: 80, padding: 3, fontSize: 9, textAlign: "right" },
    // Footer
    footerRow: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderColor: "#000",
      minHeight: 70,
    },
    footerLeft: { flex: 1, padding: 6, borderRightWidth: 1, borderColor: "#000" },
    footerRight: {
      flex: 1,
      padding: 6,
      alignItems: "flex-end",
      justifyContent: "space-between",
    },
    declLabel: { fontSize: 8, fontWeight: 700 },
    declText: { fontSize: 8, marginTop: 2 },
    panLine: { fontSize: 9, marginBottom: 6 },
    sigLabel: { fontSize: 9, fontWeight: 700 },
    sigSlot: { fontSize: 9, marginTop: 24 },
    footerNote: {
      textAlign: "center",
      fontSize: 8,
      marginTop: 4,
      color: "#555",
    },
  });

  const sup = data.supplier;
  const cons = data.consignee;
  const buy = data.buyer;
  const inv = data.invoice;
  const pan = sup.pan || panFromGstin(sup.gstin);

  // --- Components ---

  const SupplierBlock = React.createElement(
    View,
    { style: styles.supplierBlock },
    React.createElement(Text, { style: styles.supplierName }, sup.displayName),
    sup.addressLine1 && React.createElement(Text, { style: styles.addrLine }, sup.addressLine1),
    sup.addressLine2 && React.createElement(Text, { style: styles.addrLine }, sup.addressLine2),
    (sup.city || sup.pincode) && React.createElement(
      Text,
      { style: styles.addrLine },
      `${sup.city ?? ""}${sup.pincode ? ` - ${sup.pincode}` : ""}`.trim(),
    ),
    sup.gstin && React.createElement(Text, { style: styles.addrLine }, `GSTIN/UIN: ${sup.gstin}`),
    sup.stateName && React.createElement(
      Text,
      { style: styles.addrLine },
      `State Name : ${sup.stateName}${stateCode(sup.stateName) ? `, Code : ${stateCode(sup.stateName)}` : ""}`,
    ),
  );

  const metaCell = (label: string, value: string | null, border = true) =>
    React.createElement(
      View,
      { style: border ? styles.metaCellBorder : styles.metaCell },
      React.createElement(Text, { style: styles.metaLabel }, label),
      value
        ? React.createElement(Text, { style: styles.metaVal }, value)
        : null,
    );

  const MetaGrid = React.createElement(
    View,
    { style: styles.metaGrid },
    React.createElement(
      View,
      { style: styles.metaRow },
      metaCell("Invoice No.", inv.billRef),
      metaCell("Dated", fmtDate(inv.billDate), false),
    ),
    React.createElement(
      View,
      { style: styles.metaRow },
      metaCell("Delivery Note", inv.deliveryNote),
      metaCell("Mode/Terms of Payment", inv.modeOfPayment, false),
    ),
    React.createElement(
      View,
      { style: styles.metaRow },
      metaCell("Reference No. & Date.", null),
      metaCell("Other References", null, false),
    ),
    React.createElement(
      View,
      { style: styles.metaRow },
      metaCell("Buyer's Order No.", inv.buyerOrderRef),
      metaCell(
        "Dated",
        inv.buyerOrderDate ? fmtDate(inv.buyerOrderDate) : null,
        false,
      ),
    ),
    React.createElement(
      View,
      { style: styles.metaRow },
      metaCell("Dispatch Doc No.", inv.dispatchDocNo),
      metaCell("Delivery Note Date", null, false),
    ),
    React.createElement(
      View,
      { style: { ...styles.metaRow, borderBottomWidth: 0 } },
      metaCell("Dispatched through", inv.dispatchThrough),
      metaCell("Destination", inv.destination, false),
    ),
  );

  const TopRow = React.createElement(
    View,
    { style: styles.topRow },
    SupplierBlock,
    MetaGrid,
  );

  const ConsigneeBlock = React.createElement(
    View,
    { style: styles.addrBlock },
    React.createElement(Text, { style: styles.addrLabel }, "Consignee (Ship to)"),
    React.createElement(Text, { style: styles.addrName }, cons.name),
    cons.address && React.createElement(Text, { style: styles.addrLine }, cons.address),
    cons.stateName && React.createElement(
      Text,
      { style: styles.addrLine },
      `State Name : ${cons.stateName}${stateCode(cons.stateName) ? `, Code : ${stateCode(cons.stateName)}` : ""}`,
    ),
    cons.gstin && React.createElement(Text, { style: styles.addrLine }, `GSTIN/UIN : ${cons.gstin}`),
  );

  const BuyerBlock = React.createElement(
    View,
    { style: styles.addrBlock },
    React.createElement(Text, { style: styles.addrLabel }, "Buyer (Bill to)"),
    React.createElement(Text, { style: styles.addrName }, buy.name),
    buy.address && React.createElement(Text, { style: styles.addrLine }, buy.address),
    buy.stateName && React.createElement(
      Text,
      { style: styles.addrLine },
      `State Name : ${buy.stateName}${stateCode(buy.stateName) ? `, Code : ${stateCode(buy.stateName)}` : ""}`,
    ),
    buy.gstin && React.createElement(Text, { style: styles.addrLine }, `GSTIN/UIN : ${buy.gstin}`),
  );

  // --- Items table ---

  const itemsHeader = React.createElement(
    View,
    { style: styles.itemsHeader },
    React.createElement(Text, { style: styles.col_sl }, "Sl\nNo."),
    React.createElement(Text, { style: styles.col_desc }, "Description of Goods"),
    React.createElement(Text, { style: styles.col_hsn }, "HSN/SAC"),
    React.createElement(Text, { style: styles.col_qty }, "Quantity"),
    React.createElement(Text, { style: styles.col_rate }, "Rate"),
    React.createElement(Text, { style: styles.col_per }, "per"),
    React.createElement(Text, { style: styles.col_amt }, "Amount"),
  );

  const itemRows = data.items.map((it, i) =>
    React.createElement(
      View,
      { key: i, style: styles.itemsRow },
      React.createElement(Text, { style: styles.col_sl }, String(i + 1)),
      React.createElement(
        Text,
        { style: { ...styles.col_desc, ...styles.descBold } },
        it.description,
      ),
      React.createElement(Text, { style: styles.col_hsn }, it.hsnSac ?? ""),
      React.createElement(
        Text,
        { style: styles.col_qty },
        `${it.quantity}${it.unit ? ` ${it.unit}` : ""}`,
      ),
      React.createElement(
        Text,
        { style: styles.col_rate },
        it.rate.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
      ),
      React.createElement(Text, { style: styles.col_per }, it.unit ?? ""),
      React.createElement(
        Text,
        { style: styles.col_amt },
        it.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
      ),
    ),
  );

  // Tax component rows (CGST / SGST / IGST) — mirrors Tally's practice
  // of showing each tax ledger on its own italic line inside the items
  // table, aligned to the Amount column.
  const taxRows: React.ReactNode[] = [];
  if (data.totals.isIntraState) {
    if (data.totals.cgstTotal > 0) {
      taxRows.push(
        React.createElement(
          View,
          { key: "cgst", style: styles.itemsRow },
          React.createElement(Text, { style: styles.col_sl }, ""),
          React.createElement(
            Text,
            { style: { ...styles.col_desc, ...styles.taxLine, textAlign: "right" } },
            "CGST",
          ),
          React.createElement(Text, { style: styles.col_hsn }, ""),
          React.createElement(Text, { style: styles.col_qty }, ""),
          React.createElement(Text, { style: styles.col_rate }, ""),
          React.createElement(Text, { style: styles.col_per }, "%"),
          React.createElement(
            Text,
            { style: styles.col_amt },
            data.totals.cgstTotal.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
            }),
          ),
        ),
      );
    }
    if (data.totals.sgstTotal > 0) {
      taxRows.push(
        React.createElement(
          View,
          { key: "sgst", style: styles.itemsRow },
          React.createElement(Text, { style: styles.col_sl }, ""),
          React.createElement(
            Text,
            { style: { ...styles.col_desc, ...styles.taxLine, textAlign: "right" } },
            "SGST",
          ),
          React.createElement(Text, { style: styles.col_hsn }, ""),
          React.createElement(Text, { style: styles.col_qty }, ""),
          React.createElement(Text, { style: styles.col_rate }, ""),
          React.createElement(Text, { style: styles.col_per }, "%"),
          React.createElement(
            Text,
            { style: styles.col_amt },
            data.totals.sgstTotal.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
            }),
          ),
        ),
      );
    }
  } else if (data.totals.igstTotal > 0) {
    taxRows.push(
      React.createElement(
        View,
        { key: "igst", style: styles.itemsRow },
        React.createElement(Text, { style: styles.col_sl }, ""),
        React.createElement(
          Text,
          { style: { ...styles.col_desc, ...styles.taxLine, textAlign: "right" } },
          "IGST",
        ),
        React.createElement(Text, { style: styles.col_hsn }, ""),
        React.createElement(Text, { style: styles.col_qty }, ""),
        React.createElement(Text, { style: styles.col_rate }, ""),
        React.createElement(Text, { style: styles.col_per }, "%"),
        React.createElement(
          Text,
          { style: styles.col_amt },
          data.totals.igstTotal.toLocaleString("en-IN", {
            minimumFractionDigits: 2,
          }),
        ),
      ),
    );
  }

  const totalQty = data.items.reduce((s, i) => s + i.quantity, 0);
  const totalRow = React.createElement(
    View,
    { style: styles.totalRow },
    React.createElement(Text, { style: styles.col_sl }, ""),
    React.createElement(
      Text,
      { style: { ...styles.col_desc, fontWeight: 700 } },
      "Total",
    ),
    React.createElement(Text, { style: styles.col_hsn }, ""),
    React.createElement(
      Text,
      { style: { ...styles.col_qty, fontWeight: 700 } },
      `${totalQty}`,
    ),
    React.createElement(Text, { style: styles.col_rate }, ""),
    React.createElement(Text, { style: styles.col_per }, ""),
    React.createElement(
      Text,
      { style: { ...styles.col_amt, fontWeight: 700 } },
      fmtINR(data.totals.grandTotal),
    ),
  );

  const amountWords = React.createElement(
    View,
    null,
    React.createElement(
      View,
      { style: styles.amountWordsRow },
      React.createElement(
        Text,
        { style: { ...styles.addrLabel, fontSize: 8 } },
        "Amount Chargeable (in words)",
      ),
      React.createElement(Text, { style: styles.addrLabel }, "E. & O.E"),
    ),
    React.createElement(
      Text,
      { style: { ...styles.amountWords, paddingHorizontal: 4, paddingBottom: 4, fontWeight: 700 } },
      `INR ${numberToWordsINR(data.totals.grandTotal)}`,
    ),
  );

  // --- HSN tax summary (bottom) ---
  // Group items by HSN + rate
  const hsnGroups = new Map<
    string,
    { taxable: number; cgst: number; sgst: number; igst: number; total: number; rate: number }
  >();
  for (const item of data.items) {
    const key = `${item.hsnSac ?? ""}`;
    const taxable = item.amount;
    const taxAmt = (taxable * item.gstRate) / 100;
    const cgst = data.totals.isIntraState ? taxAmt / 2 : 0;
    const sgst = data.totals.isIntraState ? taxAmt / 2 : 0;
    const igst = data.totals.isIntraState ? 0 : taxAmt;
    const existing = hsnGroups.get(key) ?? {
      taxable: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      total: 0,
      rate: item.gstRate,
    };
    existing.taxable += taxable;
    existing.cgst += cgst;
    existing.sgst += sgst;
    existing.igst += igst;
    existing.total += taxAmt;
    hsnGroups.set(key, existing);
  }

  const hsnHeader = data.totals.isIntraState
    ? React.createElement(
        View,
        null,
        React.createElement(
          View,
          { style: styles.hsnHeader },
          React.createElement(
            Text,
            { style: { ...styles.hsnCol_hsn, fontWeight: 700 } },
            "HSN/SAC",
          ),
          React.createElement(
            Text,
            { style: { ...styles.hsnCol_taxable, fontWeight: 700 } },
            "Taxable\nValue",
          ),
          React.createElement(
            Text,
            { style: { ...styles.hsnCol_tax, fontWeight: 700 } },
            "CGST",
          ),
          React.createElement(
            Text,
            { style: { ...styles.hsnCol_tax, fontWeight: 700 } },
            "SGST/UTGST",
          ),
          React.createElement(
            Text,
            { style: { ...styles.hsnCol_total, fontWeight: 700 } },
            "Total\nTax Amount",
          ),
        ),
        React.createElement(
          View,
          { style: styles.hsnSubHeader },
          React.createElement(Text, { style: { ...styles.hsnCol_hsn } }, ""),
          React.createElement(Text, { style: { ...styles.hsnCol_taxable } }, ""),
          React.createElement(
            View,
            { style: { ...styles.hsnCol_tax, flexDirection: "row", padding: 0, borderRightWidth: 1, borderColor: "#000" } },
            React.createElement(Text, { style: { flex: 1, textAlign: "center", padding: 3, fontWeight: 700 } }, "Rate"),
            React.createElement(Text, { style: { flex: 1, textAlign: "center", padding: 3, borderLeftWidth: 1, borderColor: "#000", fontWeight: 700 } }, "Amount"),
          ),
          React.createElement(
            View,
            { style: { ...styles.hsnCol_tax, flexDirection: "row", padding: 0, borderRightWidth: 1, borderColor: "#000" } },
            React.createElement(Text, { style: { flex: 1, textAlign: "center", padding: 3, fontWeight: 700 } }, "Rate"),
            React.createElement(Text, { style: { flex: 1, textAlign: "center", padding: 3, borderLeftWidth: 1, borderColor: "#000", fontWeight: 700 } }, "Amount"),
          ),
          React.createElement(Text, { style: { ...styles.hsnCol_total } }, ""),
        ),
      )
    : React.createElement(
        View,
        { style: styles.hsnHeader },
        React.createElement(
          Text,
          { style: { ...styles.hsnCol_hsn, fontWeight: 700 } },
          "HSN/SAC",
        ),
        React.createElement(
          Text,
          { style: { ...styles.hsnCol_taxable, fontWeight: 700 } },
          "Taxable Value",
        ),
        React.createElement(
          View,
          { style: { ...styles.hsnCol_tax, flexDirection: "row", padding: 0, borderRightWidth: 1, borderColor: "#000" } },
          React.createElement(Text, { style: { flex: 1, textAlign: "center", padding: 3, fontWeight: 700 } }, "IGST Rate"),
          React.createElement(Text, { style: { flex: 1, textAlign: "center", padding: 3, borderLeftWidth: 1, borderColor: "#000", fontWeight: 700 } }, "Amount"),
        ),
        React.createElement(
          Text,
          { style: { ...styles.hsnCol_total, fontWeight: 700 } },
          "Total Tax Amount",
        ),
      );

  const hsnRows = [...hsnGroups.entries()].map(([hsn, g], i) =>
    React.createElement(
      View,
      { key: i, style: styles.hsnRow },
      React.createElement(Text, { style: styles.hsnCol_hsn }, hsn || "—"),
      React.createElement(
        Text,
        { style: styles.hsnCol_taxable },
        g.taxable.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
      ),
      data.totals.isIntraState
        ? React.createElement(
            View,
            { style: { ...styles.hsnCol_tax, flexDirection: "row", padding: 0, borderRightWidth: 1, borderColor: "#000" } },
            React.createElement(
              Text,
              { style: { flex: 1, textAlign: "center", padding: 3, fontSize: 9 } },
              `${(g.rate / 2).toFixed(0)}%`,
            ),
            React.createElement(
              Text,
              { style: { flex: 1, textAlign: "right", padding: 3, borderLeftWidth: 1, borderColor: "#000", fontSize: 9 } },
              g.cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
            ),
          )
        : React.createElement(
            View,
            { style: { ...styles.hsnCol_tax, flexDirection: "row", padding: 0, borderRightWidth: 1, borderColor: "#000" } },
            React.createElement(
              Text,
              { style: { flex: 1, textAlign: "center", padding: 3, fontSize: 9 } },
              `${g.rate.toFixed(0)}%`,
            ),
            React.createElement(
              Text,
              { style: { flex: 1, textAlign: "right", padding: 3, borderLeftWidth: 1, borderColor: "#000", fontSize: 9 } },
              g.igst.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
            ),
          ),
      data.totals.isIntraState
        ? React.createElement(
            View,
            { style: { ...styles.hsnCol_tax, flexDirection: "row", padding: 0, borderRightWidth: 1, borderColor: "#000" } },
            React.createElement(
              Text,
              { style: { flex: 1, textAlign: "center", padding: 3, fontSize: 9 } },
              `${(g.rate / 2).toFixed(0)}%`,
            ),
            React.createElement(
              Text,
              { style: { flex: 1, textAlign: "right", padding: 3, borderLeftWidth: 1, borderColor: "#000", fontSize: 9 } },
              g.sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
            ),
          )
        : null,
      React.createElement(
        Text,
        { style: styles.hsnCol_total },
        g.total.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
      ),
    ),
  );

  const hsnTotal = React.createElement(
    View,
    { style: { ...styles.hsnRow, fontWeight: 700 } },
    React.createElement(
      Text,
      { style: { ...styles.hsnCol_hsn, fontWeight: 700, textAlign: "right" } },
      "Total",
    ),
    React.createElement(
      Text,
      { style: { ...styles.hsnCol_taxable, fontWeight: 700 } },
      data.totals.taxableTotal.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
      }),
    ),
    data.totals.isIntraState
      ? React.createElement(
          View,
          { style: { ...styles.hsnCol_tax, flexDirection: "row", padding: 0, borderRightWidth: 1, borderColor: "#000" } },
          React.createElement(Text, { style: { flex: 1, padding: 3 } }, ""),
          React.createElement(
            Text,
            { style: { flex: 1, textAlign: "right", padding: 3, borderLeftWidth: 1, borderColor: "#000", fontWeight: 700 } },
            data.totals.cgstTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
          ),
        )
      : React.createElement(
          View,
          { style: { ...styles.hsnCol_tax, flexDirection: "row", padding: 0, borderRightWidth: 1, borderColor: "#000" } },
          React.createElement(Text, { style: { flex: 1, padding: 3 } }, ""),
          React.createElement(
            Text,
            { style: { flex: 1, textAlign: "right", padding: 3, borderLeftWidth: 1, borderColor: "#000", fontWeight: 700 } },
            data.totals.igstTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
          ),
        ),
    data.totals.isIntraState
      ? React.createElement(
          View,
          { style: { ...styles.hsnCol_tax, flexDirection: "row", padding: 0, borderRightWidth: 1, borderColor: "#000" } },
          React.createElement(Text, { style: { flex: 1, padding: 3 } }, ""),
          React.createElement(
            Text,
            { style: { flex: 1, textAlign: "right", padding: 3, borderLeftWidth: 1, borderColor: "#000", fontWeight: 700 } },
            data.totals.sgstTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
          ),
        )
      : null,
    React.createElement(
      Text,
      { style: { ...styles.hsnCol_total, fontWeight: 700 } },
      (data.totals.cgstTotal + data.totals.sgstTotal + data.totals.igstTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
    ),
  );

  const taxWordsBlock = React.createElement(
    View,
    { style: { padding: 4, borderTopWidth: 1, borderColor: "#000" } },
    React.createElement(
      Text,
      { style: { fontSize: 8 } },
      "Tax Amount (in words) : ",
      React.createElement(
        Text,
        { style: { fontSize: 9, fontWeight: 700 } },
        `INR ${numberToWordsINR(
          data.totals.cgstTotal + data.totals.sgstTotal + data.totals.igstTotal,
        )}`,
      ),
    ),
  );

  const footerRow = React.createElement(
    View,
    { style: styles.footerRow },
    React.createElement(
      View,
      { style: styles.footerLeft },
      pan && React.createElement(
        Text,
        { style: styles.panLine },
        `Company's PAN : ${pan}`,
      ),
      React.createElement(Text, { style: styles.declLabel }, "Declaration"),
      React.createElement(
        Text,
        { style: styles.declText },
        "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
      ),
    ),
    React.createElement(
      View,
      { style: styles.footerRight },
      React.createElement(Text, { style: styles.sigLabel }, data.signatoryLabel),
      React.createElement(Text, { style: styles.sigSlot }, "Authorised Signatory"),
    ),
  );

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.title }, "Tax Invoice"),
      React.createElement(
        View,
        { style: styles.outer },
        TopRow,
        ConsigneeBlock,
        BuyerBlock,
        // Items table
        itemsHeader,
        ...itemRows,
        ...taxRows,
        totalRow,
        amountWords,
        // HSN summary
        React.createElement(
          View,
          { style: styles.hsnTable },
          hsnHeader,
          ...hsnRows,
          hsnTotal,
        ),
        taxWordsBlock,
        footerRow,
      ),
      React.createElement(
        Text,
        { style: styles.footerNote },
        "This is a Computer Generated Invoice",
      ),
    ),
  );

  return await ReactPDF.renderToBuffer(doc);
}
