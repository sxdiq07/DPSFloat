"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

const saveSchema = z.object({
  name: z.string().min(1).max(60),
  path: z.string().min(1),
  params: z.string(),
});

export async function saveView(
  input: z.infer<typeof saveSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    const session = await requireAuth();
    await prisma.savedView.create({
      data: {
        ownerId: session.user.id,
        name: parsed.data.name,
        path: parsed.data.path,
        params: parsed.data.params,
      },
    });
    revalidatePath("/clients");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Save failed",
    };
  }
}

export async function deleteView(
  viewId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireAuth();
    const view = await prisma.savedView.findFirst({
      where: { id: viewId, ownerId: session.user.id },
      select: { id: true },
    });
    if (!view) return { ok: false, error: "Not found" };
    await prisma.savedView.delete({ where: { id: view.id } });
    revalidatePath("/clients");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Delete failed",
    };
  }
}
