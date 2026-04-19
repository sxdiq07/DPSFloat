"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";

const addSchema = z.object({
  clientCompanyId: z.string(),
  partyId: z.string().optional().nullable(),
  body: z.string().min(1).max(2000),
});

export async function addNote(
  input: z.infer<typeof addSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    const session = await requireAuth();
    const firmId = await requireFirmId();
    const client = await prisma.clientCompany.findFirst({
      where: { id: parsed.data.clientCompanyId, firmId },
      select: { id: true },
    });
    if (!client) return { ok: false, error: "Client not found" };
    const note = await prisma.note.create({
      data: {
        clientCompanyId: client.id,
        partyId: parsed.data.partyId || null,
        authorId: session.user.id,
        body: parsed.data.body,
      },
    });
    revalidatePath(`/clients/${client.id}`);
    return { ok: true, id: note.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function deleteNote(
  noteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireAuth();
    const firmId = await requireFirmId();
    const note = await prisma.note.findFirst({
      where: { id: noteId, clientCompany: { firmId } },
      select: { id: true, authorId: true, clientCompanyId: true },
    });
    if (!note) return { ok: false, error: "Note not found" };
    // Only author or a partner can delete
    if (note.authorId !== session.user.id && session.user.role !== "PARTNER") {
      return { ok: false, error: "Not permitted" };
    }
    await prisma.note.delete({ where: { id: note.id } });
    revalidatePath(`/clients/${note.clientCompanyId}`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
