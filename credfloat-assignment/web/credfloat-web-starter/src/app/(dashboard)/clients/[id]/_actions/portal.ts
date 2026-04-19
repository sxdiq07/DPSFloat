"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";

export async function generatePortalToken(
  clientId: string,
  expiresInDays = 30,
): Promise<
  | { ok: true; token: string; url: string; expiresAt: string }
  | { ok: false; error: string }
> {
  try {
    const session = await requireAuth();
    const firmId = await requireFirmId();
    const client = await prisma.clientCompany.findFirst({
      where: { id: clientId, firmId },
      select: { id: true },
    });
    if (!client) return { ok: false, error: "Client not found" };

    // Revoke any currently active tokens so only one link is live per client
    await prisma.portalToken.updateMany({
      where: { clientCompanyId: client.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + expiresInDays * 86400_000);

    await prisma.portalToken.create({
      data: {
        clientCompanyId: client.id,
        token,
        createdBy: session.user.id,
        expiresAt,
      },
    });

    const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    revalidatePath(`/clients/${client.id}`);
    return {
      ok: true,
      token,
      url: `${base}/portal/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Generate failed",
    };
  }
}

export async function revokePortalToken(
  tokenId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const firmId = await requireFirmId();
    const tok = await prisma.portalToken.findFirst({
      where: { id: tokenId, clientCompany: { firmId } },
      select: { id: true, clientCompanyId: true },
    });
    if (!tok) return { ok: false, error: "Not found" };
    await prisma.portalToken.update({
      where: { id: tok.id },
      data: { revokedAt: new Date() },
    });
    revalidatePath(`/clients/${tok.clientCompanyId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Revoke failed",
    };
  }
}
