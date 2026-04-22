"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  partyIds: z.array(z.string()).min(1).max(500),
  action: z.enum(["PAUSE_REMINDERS", "RESUME_REMINDERS", "OPT_OUT"]),
  reason: z.string().max(200).optional().nullable(),
});

/**
 * Batch action on a selected set of debtors from the client detail
 * page. `optedOut: true` takes them out of the cron reminder scope
 * and the manual Send action also refuses. RESUME flips it back.
 * OPT_OUT is identical to PAUSE today (same DB field) but preserved
 * as a distinct action for future DPDP audit filtering.
 */
export async function bulkDebtorAction(
  input: z.infer<typeof schema>,
): Promise<
  { ok: true; affected: number } | { ok: false; error: string }
> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const session = await requireAuth();
  const firmId = await requireFirmId();

  // Scope by firm — users can only touch their firm's parties.
  const parties = await prisma.party.findMany({
    where: {
      id: { in: parsed.data.partyIds },
      clientCompany: { firmId },
    },
    select: { id: true, clientCompanyId: true, tallyLedgerName: true },
  });
  if (parties.length === 0) return { ok: false, error: "No valid parties" };

  const data: {
    optedOut?: boolean;
    optedOutReason?: string | null;
  } = {};
  if (parsed.data.action === "PAUSE_REMINDERS") {
    data.optedOut = true;
    data.optedOutReason =
      parsed.data.reason || "Paused by staff (bulk action)";
  } else if (parsed.data.action === "RESUME_REMINDERS") {
    data.optedOut = false;
    data.optedOutReason = null;
  } else {
    data.optedOut = true;
    data.optedOutReason = parsed.data.reason || "Debtor opted out";
  }

  await prisma.party.updateMany({
    where: { id: { in: parties.map((p) => p.id) } },
    data,
  });

  await Promise.all(
    parties.map((p) =>
      logActivity({
        firmId,
        actorId: session.user.id,
        action: `party.bulk_${parsed.data.action.toLowerCase()}`,
        targetType: "Party",
        targetId: p.id,
        meta: { reason: parsed.data.reason ?? null },
      }),
    ),
  );

  const touchedClientIds = [...new Set(parties.map((p) => p.clientCompanyId))];
  for (const cid of touchedClientIds) revalidatePath(`/clients/${cid}`);

  return { ok: true, affected: parties.length };
}
