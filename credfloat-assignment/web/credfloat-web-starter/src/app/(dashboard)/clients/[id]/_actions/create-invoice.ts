"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { computeAgeBucket } from "@/lib/ageing";
import { computeTotals } from "@/lib/gst";

const lineItemSchema = z.object({
  description: z.string().min(1).max(300),
  hsnSac: z.string().max(20).optional().nullable(),
  unit: z.string().max(20).optional().nullable(),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
  gstRate: z.number().min(0).max(100),
});

const schema = z.object({
  clientCompanyId: z.string(),
  partyId: z.string(),
  billRef: z.string().min(1).max(100),
  billDate: z.string(), // ISO
  dueDate: z.string().optional().nullable(),
  supplierGstin: z.string().max(15).optional().nullable(),
  recipientGstin: z.string().max(15).optional().nullable(),
  placeOfSupply: z.string().max(60).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  // Tally-style Tax Invoice extras (all optional)
  supplierPan: z.string().max(10).optional().nullable(),
  consigneeName: z.string().max(200).optional().nullable(),
  consigneeAddress: z.string().max(500).optional().nullable(),
  deliveryNote: z.string().max(100).optional().nullable(),
  modeOfPayment: z.string().max(100).optional().nullable(),
  buyerOrderRef: z.string().max(100).optional().nullable(),
  buyerOrderDate: z.string().optional().nullable(),
  dispatchDocNo: z.string().max(100).optional().nullable(),
  dispatchThrough: z.string().max(100).optional().nullable(),
  destination: z.string().max(100).optional().nullable(),
  termsOfDelivery: z.string().max(300).optional().nullable(),
  items: z.array(lineItemSchema).min(1).max(50),
});

/**
 * Staff-created invoice for one of the client's debtors. Writes into
 * the Invoice table with origin=CREDFLOAT + line items + computed GST
 * tax split (CGST+SGST for intra-state, IGST for inter-state).
 * Bill ref must be unique per (clientCompany, party).
 */
export async function createInvoice(
  input: z.infer<typeof schema>,
): Promise<
  | { ok: true; invoiceId: string }
  | { ok: false; error: string }
> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const session = await requireAuth();
  const firmId = await requireFirmId();

  // Scope check — both client + party must belong to this firm.
  const client = await prisma.clientCompany.findFirst({
    where: { id: parsed.data.clientCompanyId, firmId },
    select: {
      id: true,
      displayName: true,
      gstin: true,
      defaultPlaceOfSupply: true,
      stateName: true,
    },
  });
  if (!client) return { ok: false, error: "Client not found" };

  const party = await prisma.party.findFirst({
    where: {
      id: parsed.data.partyId,
      clientCompanyId: client.id,
      deletedAt: null,
    },
    select: { id: true, tallyLedgerName: true, stateName: true },
  });
  if (!party) return { ok: false, error: "Debtor not found" };

  // Ensure billRef uniqueness — show a helpful error rather than SQL 500.
  const existing = await prisma.invoice.findFirst({
    where: {
      clientCompanyId: client.id,
      partyId: party.id,
      billRef: parsed.data.billRef,
    },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      error: `Bill ref "${parsed.data.billRef}" already exists for this debtor`,
    };
  }

  const billDate = new Date(parsed.data.billDate);
  if (Number.isNaN(billDate.getTime()))
    return { ok: false, error: "Invalid bill date" };
  const dueDate = parsed.data.dueDate
    ? new Date(parsed.data.dueDate)
    : billDate;

  const supplierState =
    parsed.data.placeOfSupply ||
    client.defaultPlaceOfSupply ||
    client.stateName ||
    null;
  const totals = computeTotals(
    parsed.data.items,
    supplierState,
    parsed.data.placeOfSupply ?? supplierState,
  );

  const buyerOrderDate = parsed.data.buyerOrderDate
    ? new Date(parsed.data.buyerOrderDate)
    : null;

  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        clientCompanyId: client.id,
        partyId: party.id,
        billRef: parsed.data.billRef,
        billDate,
        dueDate,
        originalAmount: new Prisma.Decimal(totals.grandTotal),
        outstandingAmount: new Prisma.Decimal(totals.grandTotal),
        status: "OPEN",
        ageBucket: computeAgeBucket(dueDate),
        origin: "CREDFLOAT",
        supplierGstin: parsed.data.supplierGstin || client.gstin || null,
        recipientGstin: parsed.data.recipientGstin || null,
        placeOfSupply: parsed.data.placeOfSupply || client.defaultPlaceOfSupply || null,
        taxableAmount: new Prisma.Decimal(totals.taxableTotal),
        cgstAmount: new Prisma.Decimal(totals.cgstTotal),
        sgstAmount: new Prisma.Decimal(totals.sgstTotal),
        igstAmount: new Prisma.Decimal(totals.igstTotal),
        notes: parsed.data.notes || null,
        supplierPan: parsed.data.supplierPan || null,
        consigneeName: parsed.data.consigneeName || null,
        consigneeAddress: parsed.data.consigneeAddress || null,
        deliveryNote: parsed.data.deliveryNote || null,
        modeOfPayment: parsed.data.modeOfPayment || null,
        buyerOrderRef: parsed.data.buyerOrderRef || null,
        buyerOrderDate,
        dispatchDocNo: parsed.data.dispatchDocNo || null,
        dispatchThrough: parsed.data.dispatchThrough || null,
        destination: parsed.data.destination || null,
        termsOfDelivery: parsed.data.termsOfDelivery || null,
        lastSyncedAt: new Date(),
      },
      select: { id: true },
    });

    for (let i = 0; i < totals.items.length; i++) {
      const item = totals.items[i];
      await tx.invoiceLineItem.create({
        data: {
          invoiceId: inv.id,
          description: item.description,
          hsnSac: item.hsnSac ?? null,
          unit: (item as { unit?: string | null }).unit ?? null,
          quantity: new Prisma.Decimal(item.quantity),
          rate: new Prisma.Decimal(item.rate),
          gstRate: new Prisma.Decimal(item.gstRate),
          taxableAmount: new Prisma.Decimal(item.taxableAmount),
          taxAmount: new Prisma.Decimal(item.taxAmount),
          position: i,
        },
      });
    }
    return inv;
  });

  await logActivity({
    firmId,
    actorId: session.user.id,
    action: "invoice.generated",
    targetType: "Invoice",
    targetId: invoice.id,
    meta: {
      billRef: parsed.data.billRef,
      grandTotal: totals.grandTotal,
      partyId: party.id,
    },
  });

  revalidatePath(`/clients/${client.id}`);
  return { ok: true, invoiceId: invoice.id };
}

/**
 * Save a line-item preset for reuse on future invoices for this client.
 */
const templateSchema = z.object({
  clientCompanyId: z.string(),
  description: z.string().min(1).max(300),
  hsnSac: z.string().max(20).optional().nullable(),
  rate: z.number().nonnegative(),
  gstRate: z.number().min(0).max(100),
});

export async function saveInvoiceTemplate(
  input: z.infer<typeof templateSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  await requireAuth();
  const firmId = await requireFirmId();

  const client = await prisma.clientCompany.findFirst({
    where: { id: parsed.data.clientCompanyId, firmId },
    select: { id: true },
  });
  if (!client) return { ok: false, error: "Client not found" };

  const row = await prisma.invoiceItemTemplate.create({
    data: {
      clientCompanyId: client.id,
      description: parsed.data.description,
      hsnSac: parsed.data.hsnSac || null,
      rate: new Prisma.Decimal(parsed.data.rate),
      gstRate: new Prisma.Decimal(parsed.data.gstRate),
    },
    select: { id: true },
  });
  revalidatePath(`/clients/${client.id}`);
  return { ok: true, id: row.id };
}
