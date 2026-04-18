"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";

const addSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(["PARTNER", "STAFF"]),
});

export async function addStaff(
  input: z.infer<typeof addSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAuth();
  if (session.user.role !== "PARTNER") {
    return { ok: false, error: "Only partners can add staff." };
  }
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  try {
    const firmId = await requireFirmId();
    const existing = await prisma.firmStaff.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
      select: { id: true },
    });
    if (existing) return { ok: false, error: "Email already registered" };

    await prisma.firmStaff.create({
      data: {
        firmId,
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name,
        passwordHash: await bcrypt.hash(parsed.data.password, 10),
        role: parsed.data.role,
      },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Add failed: ${msg}` };
  }
}

export async function removeStaff(
  staffId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAuth();
  if (session.user.role !== "PARTNER") {
    return { ok: false, error: "Only partners can remove staff." };
  }
  if (session.user.id === staffId) {
    return { ok: false, error: "You cannot remove yourself." };
  }

  try {
    const firmId = await requireFirmId();
    const target = await prisma.firmStaff.findFirst({
      where: { id: staffId, firmId },
      select: { id: true, role: true },
    });
    if (!target) return { ok: false, error: "Staff not found" };

    if (target.role === "PARTNER") {
      const partnersLeft = await prisma.firmStaff.count({
        where: { firmId, role: "PARTNER", NOT: { id: staffId } },
      });
      if (partnersLeft === 0) {
        return {
          ok: false,
          error: "Cannot remove the last partner. Promote someone first.",
        };
      }
    }

    await prisma.firmStaff.delete({ where: { id: target.id } });
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Remove failed: ${msg}` };
  }
}
