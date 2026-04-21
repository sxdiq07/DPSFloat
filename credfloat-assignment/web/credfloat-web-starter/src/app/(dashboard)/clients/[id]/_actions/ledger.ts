"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { signLedgerToken, type LedgerPeriod } from "@/lib/ledger-token";
import type { LedgerPeriodType } from "@prisma/client";

const schema = z.object({ partyId: z.string() });

export type LedgerUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Resolves the client's configured ledger-period setting on their
 * ReminderRule (or falls back to FY_TO_DATE), signs a token, and
 * returns the public /api/ledger/<token> URL. The caller typically
 * opens this in a new tab to let the browser download the PDF.
 */
export async function getLedgerDownloadUrl(
  input: z.infer<typeof schema>,
): Promise<LedgerUrlResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  await requireAuth();
  const firmId = await requireFirmId();

  const party = await prisma.party.findFirst({
    where: { id: parsed.data.partyId, clientCompany: { firmId } },
    include: {
      clientCompany: {
        include: {
          reminderRules: {
            where: { enabled: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!party) return { ok: false, error: "Debtor not found" };

  const rule = party.clientCompany.reminderRules[0];
  const periodType: LedgerPeriodType = rule?.ledgerPeriodType ?? "FY_TO_DATE";
  const period = resolvePeriodFromRule(periodType, rule?.ledgerPeriodStart, rule?.ledgerPeriodEnd);

  const token = signLedgerToken({ partyId: party.id, period });
  const base =
    process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return { ok: true, url: `${base}/api/ledger/${token}` };
}

function resolvePeriodFromRule(
  type: LedgerPeriodType,
  start: Date | null | undefined,
  end: Date | null | undefined,
): LedgerPeriod {
  if (type === "CUSTOM") {
    if (!start || !end) return { type: "FY_TO_DATE" };
    return {
      type: "CUSTOM",
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }
  return { type };
}
