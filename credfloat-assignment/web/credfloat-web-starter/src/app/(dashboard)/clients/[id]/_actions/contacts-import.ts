"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { logActivity } from "@/lib/activity";

/**
 * Excel contact import — per-client scope.
 *
 * Flow:
 *   1. Staff uploads an .xlsx (or .csv) with columns:
 *        Ledger Name | Email | Phone | WhatsApp
 *   2. preview() parses + matches rows against this client's debtors
 *      by tallyLedgerName (case-insensitive, trimmed). Returns what
 *      will change.
 *   3. commit() applies. Empty cells leave existing values alone.
 *      Non-empty cells are applied per the `overwrite` flag.
 *
 * No new debtors are ever created — Party rows come from Tally only.
 */

export type PreviewRow = {
  ledgerName: string;
  partyId: string | null;
  partyNameMatched: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  existing: {
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
  } | null;
  status: "match" | "unmatched";
  wouldChange: {
    email: "set" | "overwrite" | "skip" | "unchanged";
    phone: "set" | "overwrite" | "skip" | "unchanged";
    whatsapp: "set" | "overwrite" | "skip" | "unchanged";
  };
};

export type PreviewResult = {
  ok: true;
  rows: PreviewRow[];
  summary: {
    totalRows: number;
    matched: number;
    unmatched: number;
    willUpdate: number;
    willOverwrite: number;
  };
};

type PreviewInput = {
  clientCompanyId: string;
  fileBase64: string;
  overwrite: boolean;
};

function normEmail(s: unknown): string | null {
  if (!s) return null;
  const v = String(s).trim().toLowerCase();
  if (!v || !v.includes("@")) return null;
  return v;
}

function normPhone(s: unknown): string | null {
  if (!s) return null;
  const digits = String(s).replace(/\D/g, "");
  if (digits.length < 7) return null;
  // Normalize to +91... if it's a 10-digit Indian number
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

function parseWorkbook(buf: Buffer): Array<Record<string, unknown>> {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function pickCol(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const key of Object.keys(row)) {
    const lower = key.toLowerCase().trim();
    if (names.some((n) => lower === n)) return row[key];
  }
  // Try fuzzy contains
  for (const key of Object.keys(row)) {
    const lower = key.toLowerCase();
    if (names.some((n) => lower.includes(n))) return row[key];
  }
  return undefined;
}

export async function previewContactImport(
  input: PreviewInput,
): Promise<PreviewResult | { ok: false; error: string }> {
  const session = await requireAuth();
  const firmId = await requireFirmId();

  const client = await prisma.clientCompany.findFirst({
    where: { id: input.clientCompanyId, firmId },
    select: {
      id: true,
      parties: {
        where: { deletedAt: null },
        select: {
          id: true,
          tallyLedgerName: true,
          email: true,
          phone: true,
          whatsappNumber: true,
        },
      },
    },
  });
  if (!client) return { ok: false, error: "Client not found" };

  const byName = new Map<string, (typeof client.parties)[number]>();
  for (const p of client.parties) {
    byName.set(p.tallyLedgerName.trim().toLowerCase(), p);
  }

  let buf: Buffer;
  try {
    const base64 = input.fileBase64.includes(",")
      ? input.fileBase64.split(",", 2)[1]
      : input.fileBase64;
    buf = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, error: "Could not decode file upload" };
  }

  let raw: Array<Record<string, unknown>>;
  try {
    raw = parseWorkbook(buf);
  } catch (err) {
    return {
      ok: false,
      error: `Could not parse spreadsheet: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const rows: PreviewRow[] = [];
  let willUpdate = 0;
  let willOverwrite = 0;

  for (const r of raw) {
    const ledgerName = String(
      pickCol(r, "ledger name", "ledgername", "party", "name") ?? "",
    ).trim();
    if (!ledgerName) continue;

    const email = normEmail(pickCol(r, "email", "e-mail"));
    const phone = normPhone(pickCol(r, "phone", "mobile", "telephone"));
    const whatsapp = normPhone(pickCol(r, "whatsapp", "wa", "wa number"));

    const match = byName.get(ledgerName.toLowerCase());
    if (!match) {
      rows.push({
        ledgerName,
        partyId: null,
        partyNameMatched: null,
        email,
        phone,
        whatsapp,
        existing: null,
        status: "unmatched",
        wouldChange: {
          email: "skip",
          phone: "skip",
          whatsapp: "skip",
        },
      });
      continue;
    }

    const wouldChange = {
      email: decideChange(email, match.email, input.overwrite),
      phone: decideChange(phone, match.phone, input.overwrite),
      whatsapp: decideChange(whatsapp, match.whatsappNumber, input.overwrite),
    };
    const touches = Object.values(wouldChange).filter(
      (v) => v === "set" || v === "overwrite",
    );
    if (touches.length > 0) {
      willUpdate++;
      if (touches.includes("overwrite")) willOverwrite++;
    }
    rows.push({
      ledgerName,
      partyId: match.id,
      partyNameMatched: match.tallyLedgerName,
      email,
      phone,
      whatsapp,
      existing: {
        email: match.email,
        phone: match.phone,
        whatsapp: match.whatsappNumber,
      },
      status: "match",
      wouldChange,
    });
  }

  void session; // prevents unused-var error

  return {
    ok: true,
    rows,
    summary: {
      totalRows: rows.length,
      matched: rows.filter((r) => r.status === "match").length,
      unmatched: rows.filter((r) => r.status === "unmatched").length,
      willUpdate,
      willOverwrite,
    },
  };
}

function decideChange(
  incoming: string | null,
  existing: string | null,
  overwrite: boolean,
): "set" | "overwrite" | "skip" | "unchanged" {
  if (!incoming) return "unchanged";
  if (!existing) return "set";
  if (incoming === existing) return "unchanged";
  return overwrite ? "overwrite" : "skip";
}

const commitSchema = z.object({
  clientCompanyId: z.string(),
  fileBase64: z.string(),
  overwrite: z.boolean(),
});

export async function commitContactImport(
  input: z.infer<typeof commitSchema>,
): Promise<
  | { ok: true; updated: number; overwritten: number; unmatched: number }
  | { ok: false; error: string }
> {
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const session = await requireAuth();
  const firmId = await requireFirmId();

  // Re-run the preview with the exact same inputs — same code path
  // used by the UI, so what we show is literally what we'll do.
  const pre = await previewContactImport(parsed.data);
  if (!("rows" in pre)) return pre;

  let updated = 0;
  let overwritten = 0;

  for (const row of pre.rows) {
    if (row.status !== "match" || !row.partyId) continue;
    const data: {
      email?: string | null;
      phone?: string | null;
      whatsappNumber?: string | null;
    } = {};

    if (row.wouldChange.email === "set" || row.wouldChange.email === "overwrite") {
      data.email = row.email;
      if (row.wouldChange.email === "overwrite") overwritten++;
    }
    if (row.wouldChange.phone === "set" || row.wouldChange.phone === "overwrite") {
      data.phone = row.phone;
      if (row.wouldChange.phone === "overwrite") overwritten++;
    }
    if (
      row.wouldChange.whatsapp === "set" ||
      row.wouldChange.whatsapp === "overwrite"
    ) {
      data.whatsappNumber = row.whatsapp;
      if (row.wouldChange.whatsapp === "overwrite") overwritten++;
    }

    if (Object.keys(data).length === 0) continue;

    await prisma.party.update({
      where: { id: row.partyId },
      data,
    });
    updated++;

    await logActivity({
      firmId,
      actorId: session.user.id,
      action: "contacts.imported",
      targetType: "Party",
      targetId: row.partyId,
      meta: {
        fields: Object.keys(data),
        overwrote: row.wouldChange.email === "overwrite" ||
          row.wouldChange.phone === "overwrite" ||
          row.wouldChange.whatsapp === "overwrite",
      },
    });
  }

  revalidatePath(`/clients/${parsed.data.clientCompanyId}`);

  return {
    ok: true,
    updated,
    overwritten,
    unmatched: pre.summary.unmatched,
  };
}

/**
 * Returns a base64 data URL for a starter template the user downloads,
 * fills, and re-uploads.
 */
export async function getContactImportTemplate(): Promise<string> {
  const wb = XLSX.utils.book_new();
  const rows = [
    {
      "Ledger Name": "ACME Trading Co",
      Email: "accounts@acme.co.in",
      Phone: "9876543210",
      WhatsApp: "9876543210",
    },
    {
      "Ledger Name": "Example Debtor (delete this row)",
      Email: "",
      Phone: "",
      WhatsApp: "",
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Debtors");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(buf).toString("base64")}`;
}
