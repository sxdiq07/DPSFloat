import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type LogInput = {
  firmId: string;
  actorId?: string | null;
  action: string;
  targetType:
    | "ClientCompany"
    | "Party"
    | "Invoice"
    | "ReminderRule"
    | "ReminderSent"
    | "FirmStaff"
    | "Firm"
    | "PortalToken"
    | "PromiseToPay"
    | "Note";
  targetId: string;
  meta?: Prisma.InputJsonValue;
};

/**
 * Append-only activity log. Fire-and-forget — failures don't bubble,
 * because the audit trail must never block the user-facing action.
 */
export async function logActivity(input: LogInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        firmId: input.firmId,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        meta: input.meta,
      },
    });
  } catch (err) {
    console.error("[activity-log] failed to write:", err);
  }
}
