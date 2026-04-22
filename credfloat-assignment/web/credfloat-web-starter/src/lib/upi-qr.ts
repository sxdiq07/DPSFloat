import QRCode from "qrcode";

/**
 * UPI deep-link + QR code generation.
 *
 * The `upi://pay?...` scheme is an NPCI standard — any UPI app (GPay,
 * PhonePe, Paytm, BHIM, bank apps) will open it with amount and
 * narration pre-filled. Scanning the QR has the same effect.
 *
 * Spec: https://www.npci.org.in/PDF/upi/UPI-Linking-Specs-ver-1.2.pdf
 */
export interface UpiArgs {
  vpa: string;                // payee VPA / UPI id, e.g. "dpsco@hdfcbank"
  payeeName: string;          // shown in the debtor's UPI app
  amount?: number;            // INR; optional (debtor can fill in)
  note?: string;              // transaction note / bill reference
  merchantCode?: string;      // 4-char MCC; optional
}

export function buildUpiUri(args: UpiArgs): string {
  const params = new URLSearchParams();
  params.set("pa", args.vpa);
  params.set("pn", args.payeeName);
  if (args.amount && args.amount > 0) {
    params.set("am", args.amount.toFixed(2));
  }
  params.set("cu", "INR");
  if (args.note) params.set("tn", args.note.slice(0, 80));
  if (args.merchantCode) params.set("mc", args.merchantCode);
  return `upi://pay?${params.toString()}`;
}

/**
 * Returns the UPI deep link + a PNG data URL you can drop straight
 * into an <img src="..."> tag or a @react-pdf <Image src="..."> node.
 * Larger `width` → crisper on Retina phones. 220px is a good default.
 */
export async function buildUpiQr(
  args: UpiArgs,
  width = 220,
): Promise<{ uri: string; dataUrl: string }> {
  const uri = buildUpiUri(args);
  const dataUrl = await QRCode.toDataURL(uri, {
    errorCorrectionLevel: "M",
    margin: 1,
    width,
    color: { dark: "#111111", light: "#ffffff" },
  });
  return { uri, dataUrl };
}
