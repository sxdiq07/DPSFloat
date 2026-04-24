"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, X, Trash2, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { computeTotals, INDIAN_STATES, GSTIN_REGEX } from "@/lib/gst";
import { createInvoice } from "../_actions/create-invoice";

type Party = {
  id: string;
  tallyLedgerName: string;
  mailingName: string | null;
  gstin: string | null;
  stateName: string | null;
};

type Template = {
  id: string;
  description: string;
  hsnSac: string | null;
  rate: number;
  gstRate: number;
};

type LineItem = {
  description: string;
  hsnSac: string;
  quantity: number;
  rate: number;
  gstRate: number;
};

/**
 * "New invoice" creation UI. Drawer-style modal.
 *
 * Form pieces:
 *   1. Recipient — debtor picker (existing Party from this client)
 *   2. Invoice header — bill ref, bill date, due date
 *   3. GSTINs + place of supply (auto-filled from client + debtor)
 *   4. Line items — add/remove rows, inline totals
 *   5. Templates — one-click add a saved preset
 *   6. Live totals — taxable, CGST, SGST, IGST, grand
 */
export function NewInvoiceButton({
  clientCompanyId,
  clientSupplierGstin,
  clientPlaceOfSupply,
  parties,
  templates,
}: {
  clientCompanyId: string;
  clientSupplierGstin: string | null;
  clientPlaceOfSupply: string | null;
  parties: Party[];
  templates: Template[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startPending] = useTransition();

  const [partyId, setPartyId] = useState<string>("");
  const [billRef, setBillRef] = useState<string>("");
  const [billDate, setBillDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState<string>("");
  const [supplierGstin, setSupplierGstin] = useState<string>(
    clientSupplierGstin ?? "",
  );
  const [recipientGstin, setRecipientGstin] = useState<string>("");
  const [placeOfSupply, setPlaceOfSupply] = useState<string>(
    clientPlaceOfSupply ?? "",
  );
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<LineItem[]>([
    { description: "", hsnSac: "", quantity: 1, rate: 0, gstRate: 18 },
  ]);

  const selectedParty = useMemo(
    () => parties.find((p) => p.id === partyId) ?? null,
    [parties, partyId],
  );

  // When a debtor is picked, auto-fill their GSTIN + state if present.
  const onPartyChange = (id: string) => {
    setPartyId(id);
    const p = parties.find((x) => x.id === id);
    if (p) {
      if (p.gstin) setRecipientGstin(p.gstin);
      if (p.stateName) setPlaceOfSupply(p.stateName);
    }
  };

  const totals = useMemo(
    () =>
      computeTotals(
        items.filter((i) => i.description.trim()),
        clientPlaceOfSupply,
        placeOfSupply,
      ),
    [items, clientPlaceOfSupply, placeOfSupply],
  );

  const addItem = () =>
    setItems((s) => [
      ...s,
      { description: "", hsnSac: "", quantity: 1, rate: 0, gstRate: 18 },
    ]);
  const removeItem = (i: number) =>
    setItems((s) => s.filter((_, idx) => idx !== i));
  const updateItem = (i: number, patch: Partial<LineItem>) =>
    setItems((s) => s.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const applyTemplate = (t: Template) =>
    setItems((s) => [
      ...s,
      {
        description: t.description,
        hsnSac: t.hsnSac ?? "",
        quantity: 1,
        rate: t.rate,
        gstRate: t.gstRate,
      },
    ]);

  const submit = () => {
    if (!partyId) {
      toast.error("Pick a debtor");
      return;
    }
    if (!billRef.trim()) {
      toast.error("Enter a bill reference");
      return;
    }
    const validItems = items.filter((i) => i.description.trim());
    if (validItems.length === 0) {
      toast.error("Add at least one line item");
      return;
    }
    if (supplierGstin && !GSTIN_REGEX.test(supplierGstin)) {
      toast.error("Supplier GSTIN format is invalid");
      return;
    }
    if (recipientGstin && !GSTIN_REGEX.test(recipientGstin)) {
      toast.error("Recipient GSTIN format is invalid");
      return;
    }

    startPending(async () => {
      const r = await createInvoice({
        clientCompanyId,
        partyId,
        billRef: billRef.trim(),
        billDate,
        dueDate: dueDate || null,
        supplierGstin: supplierGstin || null,
        recipientGstin: recipientGstin || null,
        placeOfSupply: placeOfSupply || null,
        notes: notes || null,
        items: validItems,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Invoice created");
      // Reset + close
      setOpen(false);
      setPartyId("");
      setBillRef("");
      setDueDate("");
      setRecipientGstin("");
      setNotes("");
      setItems([{ description: "", hsnSac: "", quantity: 1, rate: 0, gstRate: 18 }]);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-all hover:border-[var(--color-border-hair)] hover:text-ink"
      >
        <Receipt className="h-3.5 w-3.5" />
        New invoice
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl bg-[var(--color-surface-3)] shadow-[var(--shadow-apple-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-subtle px-6 py-5">
              <div>
                <h3 className="text-[18px] font-semibold tracking-tight text-ink">
                  New invoice
                </h3>
                <p className="mt-0.5 text-[13px] text-ink-3">
                  Generate a GST-compliant invoice from DPS Ledger.
                  Lives alongside Tally-synced bills with a "Ledger" tag.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-mr-1.5 -mt-1.5 rounded-md p-1 text-ink-3 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              {/* Recipient + bill header */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Debtor (recipient)" required>
                  <select
                    value={partyId}
                    onChange={(e) => onPartyChange(e.target.value)}
                    className={selectInput}
                  >
                    <option value="">Select a debtor…</option>
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.mailingName || p.tallyLedgerName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Bill reference" required>
                  <input
                    value={billRef}
                    onChange={(e) => setBillRef(e.target.value)}
                    placeholder="e.g. CF/25-26/001"
                    className={textInput}
                  />
                </Field>
                <Field label="Bill date" required>
                  <input
                    type="date"
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
                    className={textInput}
                  />
                </Field>
                <Field label="Due date">
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className={textInput}
                  />
                </Field>
              </div>

              {/* GSTINs */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Supplier GSTIN">
                  <input
                    value={supplierGstin}
                    onChange={(e) =>
                      setSupplierGstin(e.target.value.toUpperCase())
                    }
                    placeholder="15-char GSTIN"
                    className={textInput}
                    maxLength={15}
                  />
                </Field>
                <Field label="Recipient GSTIN">
                  <input
                    value={recipientGstin}
                    onChange={(e) =>
                      setRecipientGstin(e.target.value.toUpperCase())
                    }
                    placeholder="optional"
                    className={textInput}
                    maxLength={15}
                  />
                </Field>
                <Field label="Place of supply">
                  <select
                    value={placeOfSupply}
                    onChange={(e) => setPlaceOfSupply(e.target.value)}
                    className={selectInput}
                  >
                    <option value="">Select state…</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s.code} value={s.name}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Line items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13px] font-semibold text-ink">
                    Line items
                  </h4>
                  <div className="flex items-center gap-2">
                    {templates.length > 0 && (
                      <div className="flex items-center gap-1 text-[11.5px] text-ink-3">
                        Templates:
                        {templates.slice(0, 4).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => applyTemplate(t)}
                            className="rounded-full border border-subtle px-2 py-0.5 font-medium text-ink-2 hover:border-[var(--color-border-hair)] hover:text-ink"
                          >
                            {t.description.slice(0, 24)}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={addItem}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-2.5 py-1 text-[11.5px] font-medium text-ink-2 hover:border-[var(--color-border-hair)]"
                    >
                      <Plus className="h-3 w-3" />
                      Add row
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-subtle">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-[var(--color-surface-2)] text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium">Description</th>
                        <th className="px-2 py-2 text-left font-medium">HSN/SAC</th>
                        <th className="px-2 py-2 text-right font-medium">Qty</th>
                        <th className="px-2 py-2 text-right font-medium">Rate</th>
                        <th className="px-2 py-2 text-right font-medium">GST %</th>
                        <th className="px-2 py-2 text-right font-medium">Line total</th>
                        <th className="w-6 px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => {
                        const taxable = it.quantity * it.rate;
                        const lineTotal = taxable + (taxable * it.gstRate) / 100;
                        return (
                          <tr key={i} className="border-t border-subtle">
                            <td className="px-2 py-1.5">
                              <input
                                value={it.description}
                                onChange={(e) =>
                                  updateItem(i, { description: e.target.value })
                                }
                                placeholder="Item description"
                                className={rowInput}
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                value={it.hsnSac}
                                onChange={(e) =>
                                  updateItem(i, { hsnSac: e.target.value })
                                }
                                placeholder="HSN"
                                className={rowInput}
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                value={it.quantity}
                                onChange={(e) =>
                                  updateItem(i, {
                                    quantity: Number(e.target.value) || 0,
                                  })
                                }
                                className={rowInputRight}
                                min={0}
                                step="0.01"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                value={it.rate}
                                onChange={(e) =>
                                  updateItem(i, {
                                    rate: Number(e.target.value) || 0,
                                  })
                                }
                                className={rowInputRight}
                                min={0}
                                step="0.01"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                value={it.gstRate}
                                onChange={(e) =>
                                  updateItem(i, {
                                    gstRate: Number(e.target.value) || 0,
                                  })
                                }
                                className={rowInputRight}
                                min={0}
                                step="0.5"
                              />
                            </td>
                            <td className="tabular px-2 py-1.5 text-right text-ink">
                              ₹{lineTotal.toFixed(2)}
                            </td>
                            <td className="px-2 py-1.5">
                              {items.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeItem(i)}
                                  className="text-ink-3 hover:text-[#c6373a]"
                                  title="Remove row"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Notes */}
              <Field label="Notes (optional)">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Payment terms, bank details, anything extra…"
                  rows={2}
                  className={textInput + " resize-y"}
                />
              </Field>

              {/* Totals */}
              <div className="rounded-xl border border-subtle bg-[var(--color-surface-2)] px-5 py-4">
                <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-[13px]">
                  <Row label="Taxable" value={totals.taxableTotal} />
                  {totals.isIntraState ? (
                    <>
                      <Row label="CGST" value={totals.cgstTotal} />
                      <Row label="SGST" value={totals.sgstTotal} />
                    </>
                  ) : (
                    <Row label="IGST" value={totals.igstTotal} />
                  )}
                </div>
                <div className="mt-3 flex items-baseline justify-between border-t border-subtle pt-3">
                  <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-2">
                    Grand total
                  </div>
                  <div className="tabular text-[22px] font-semibold text-ink">
                    ₹{totals.grandTotal.toFixed(2)}
                  </div>
                </div>
                {selectedParty && (
                  <p className="mt-2 text-[11px] text-ink-3">
                    {totals.isIntraState
                      ? "Intra-state supply — CGST + SGST"
                      : "Inter-state supply — IGST"}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 border-t border-subtle pt-4">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-4 py-2 text-[13px] font-medium text-ink-2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                  style={{ background: "var(--color-accent-blue)" }}
                >
                  {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Create invoice
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
        {label}
        {required && <span className="ml-0.5 text-[#c6373a]">*</span>}
      </span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-3">{label}</span>
      <span className="tabular font-medium text-ink">₹{value.toFixed(2)}</span>
    </div>
  );
}

const textInput =
  "h-9 w-full rounded-lg border border-[var(--color-border-hair)] bg-[var(--color-surface-2)] px-3 text-[13.5px] text-ink outline-none transition-colors focus:border-[var(--color-accent-blue)]";
const selectInput = textInput;
const rowInput =
  "h-8 w-full rounded-md border border-transparent bg-[var(--color-surface-2)] px-2 text-[12.5px] text-ink outline-none transition-colors hover:border-[var(--color-border-hair)] focus:border-[var(--color-accent-blue)]";
const rowInputRight = rowInput + " text-right tabular";
