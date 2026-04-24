/**
 * GST tax computation helpers.
 *
 * Indian GST rule: if supplier state == place of supply → intra-state
 * (CGST + SGST, each = gstRate/2). Otherwise → inter-state (IGST =
 * gstRate). We compare states by simple case-insensitive string match
 * (state code or name, trimmed). Users typing inconsistent values get
 * benign IGST fallback — safe for compliance.
 */

export type LineItemInput = {
  description: string;
  hsnSac?: string | null;
  quantity: number;
  rate: number;
  gstRate: number; // percent, e.g. 18
};

export type ComputedLineItem = LineItemInput & {
  taxableAmount: number;
  taxAmount: number;
  total: number;
};

export type InvoiceTotals = {
  items: ComputedLineItem[];
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  grandTotal: number;
  isIntraState: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normState(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export function isIntraState(
  supplierState: string | null | undefined,
  placeOfSupply: string | null | undefined,
): boolean {
  const a = normState(supplierState);
  const b = normState(placeOfSupply);
  if (!a || !b) return false;
  return a === b;
}

export function computeTotals(
  items: LineItemInput[],
  supplierState: string | null | undefined,
  placeOfSupply: string | null | undefined,
): InvoiceTotals {
  const intra = isIntraState(supplierState, placeOfSupply);

  const computed: ComputedLineItem[] = items.map((item) => {
    const taxable = round2(item.quantity * item.rate);
    const tax = round2((taxable * item.gstRate) / 100);
    return {
      ...item,
      taxableAmount: taxable,
      taxAmount: tax,
      total: round2(taxable + tax),
    };
  });

  const taxableTotal = round2(
    computed.reduce((s, i) => s + i.taxableAmount, 0),
  );
  const taxTotal = round2(computed.reduce((s, i) => s + i.taxAmount, 0));
  const cgstTotal = intra ? round2(taxTotal / 2) : 0;
  const sgstTotal = intra ? round2(taxTotal - cgstTotal) : 0;
  const igstTotal = intra ? 0 : taxTotal;
  const grandTotal = round2(taxableTotal + taxTotal);

  return {
    items: computed,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    grandTotal,
    isIntraState: intra,
  };
}

/**
 * Indian states + union territories, in the order they appear on
 * GST portal dropdowns. Used by the invoice form's Place of Supply
 * picker. State codes are the first 2 digits of a GSTIN.
 */
export const INDIAN_STATES: Array<{ code: string; name: string }> = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];

/** Valid GSTIN pattern — 2 digits + 10 PAN chars + 1 entity + 1 Z + 1 check. */
export const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function numberToWordsINR(num: number): string {
  // Simple Indian-format number-to-words (for "Amount in words").
  // Handles up to ~99 crore. Sufficient for everyday invoices.
  if (num === 0) return "Zero Rupees only";
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  const parts: string[] = [];
  if (rupees > 0) parts.push(`${indianWords(rupees)} Rupees`);
  if (paise > 0) parts.push(`and ${indianWords(paise)} Paise`);
  parts.push("only");
  return parts.join(" ");
}

function indianWords(n: number): string {
  if (n === 0) return "";
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  const twoDigit = (x: number): string => {
    if (x < 20) return ones[x];
    return `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ""}`;
  };
  const threeDigit = (x: number): string => {
    const h = Math.floor(x / 100);
    const rest = x % 100;
    return [h ? `${ones[h]} Hundred` : "", rest ? twoDigit(rest) : ""]
      .filter(Boolean)
      .join(" ");
  };

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  return [
    crore ? `${twoDigit(crore)} Crore` : "",
    lakh ? `${twoDigit(lakh)} Lakh` : "",
    thousand ? `${twoDigit(thousand)} Thousand` : "",
    hundred ? threeDigit(hundred) : "",
  ]
    .filter(Boolean)
    .join(" ");
}
