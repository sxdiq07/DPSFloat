"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";

type Status = "ACTIVE" | "PAUSED" | "ARCHIVED";

export async function setClientStatus(
  clientId: string,
  status: Status,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const firmId = await requireFirmId();
    const client = await prisma.clientCompany.findFirst({
      where: { id: clientId, firmId },
      select: { id: true },
    });
    if (!client) return { ok: false, error: "Client not found" };
    await prisma.clientCompany.update({
      where: { id: client.id },
      data: { status },
    });
    revalidatePath("/clients");
    revalidatePath(`/clients/${client.id}`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Status update failed: ${msg}` };
  }
}
