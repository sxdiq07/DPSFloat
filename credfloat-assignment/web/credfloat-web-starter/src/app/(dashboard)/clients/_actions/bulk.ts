"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";

const schema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]),
});

export async function bulkSetClientStatus(
  input: z.infer<typeof schema>,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    const firmId = await requireFirmId();
    const result = await prisma.clientCompany.updateMany({
      where: { id: { in: parsed.data.ids }, firmId },
      data: { status: parsed.data.status },
    });
    revalidatePath("/clients");
    return { ok: true, updated: result.count };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Bulk update failed",
    };
  }
}
