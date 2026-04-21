import { NextRequest, NextResponse } from "next/server";
import { verifyLedgerToken } from "@/lib/ledger-token";
import { buildLedgerStatement } from "@/lib/ledger-data";
import { renderLedgerPdf } from "@/lib/ledger-pdf";

export const runtime = "nodejs";

/**
 * Public PDF download endpoint used by reminder emails / WhatsApp
 * messages. Access is gated by an HMAC-signed token (see ledger-token.ts)
 * so the URL can be shared with debtors without exposing raw party ids
 * or letting anyone enumerate other debtors' ledgers.
 *
 * Tokens are single-scope (one partyId + period) and expire after
 * ~48h by default. Rotating LEDGER_TOKEN_SECRET in env instantly
 * revokes every issued link.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const payload = verifyLedgerToken(token);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid or expired ledger token" },
      { status: 401 },
    );
  }

  const statement = await buildLedgerStatement(payload.partyId, payload.period);
  if (!statement) {
    return NextResponse.json(
      { error: "Debtor not found" },
      { status: 404 },
    );
  }

  const pdf = await renderLedgerPdf(statement);
  const filenameSafe = statement.party.name
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .slice(0, 60);
  const filename = `${filenameSafe}_ledger_${statement.period.to}.pdf`;

  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
